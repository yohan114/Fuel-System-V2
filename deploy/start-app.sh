#!/usr/bin/env bash
# =============================================================================
#  Build and start (or restart) the fuel system under PM2.
#
#      sudo bash deploy/start-app.sh
#
#  This is also the update script once the server is live. Safe to re-run, and
#  it never touches the database.
#
#  PM2 on a box that already runs WorkshopOne is safe ONLY with the isolation
#  below, and this script verifies it rather than assuming it:
#
#    * the app runs as `fuelapp`, never as root;
#    * PM2_HOME is pinned to /home/fuelapp/.pm2 on EVERY pm2 call, rather than
#      trusting sudo to set HOME;
#    * before doing anything it checks no other pm2 daemon shares that home,
#      and refuses if one does.
#
#  Why that matters: pm2 keeps dump.pm2 — the list it replays on boot — in
#  $PM2_HOME, and `pm2 save` OVERWRITES it rather than merging. Under a shared
#  home, this deploy would rewrite WorkshopOne's boot list, and anything stopped
#  at that moment would not come back after the next reboot, silently.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-fuelapp}"
APP_DIR="${APP_DIR:-/var/www/fuelsystem}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
NODE_PREFIX="${NODE_PREFIX:-/opt/node-24}"
PM2_APP="${PM2_APP:-fuelsystem}"
PM2_HOME_DIR="${PM2_HOME_DIR:-/home/${APP_USER}/.pm2}"
PORT="${PORT:-3300}"
WORKSHOP_PORT="${WORKSHOP_PORT:-1929}"
NODE_PATH_ENV="${NODE_PREFIX}/bin:/usr/local/bin:/usr/bin:/bin"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -x "${NODE_PREFIX}/bin/node" ]] || die "no private node at ${NODE_PREFIX} — run deploy/bootstrap.sh first"
[[ -f "$APP_DIR/.env" ]] || die "$APP_DIR/.env missing — run deploy/bootstrap.sh first"
[[ -f "$DATA_DIR/app.db" ]] || die "$DATA_DIR/app.db missing — run deploy/install-db.sh first"

cd "$APP_DIR"

# Every pm2 call goes through this. Never `pm2` bare, never as root.
pm2do() { sudo -u "$APP_USER" env PM2_HOME="$PM2_HOME_DIR" PATH="$NODE_PATH_ENV" "${NODE_PREFIX}/bin/npx" pm2 "$@"; }
asuser() { sudo -u "$APP_USER" env PATH="$NODE_PATH_ENV" "$@"; }

# ── PM2 isolation ────────────────────────────────────────────────────────────
say "PM2 isolation from the other app on this box"
command -v pm2 >/dev/null 2>&1 || npx --yes pm2 --version >/dev/null 2>&1 || true
mkdir -p "$PM2_HOME_DIR"
chown -R "$APP_USER:$APP_USER" "$PM2_HOME_DIR"

# Which pm2 daemons are running, and out of which home? A daemon whose home is
# ours but whose user is not is the exact collision this guards against.
mapfile -t others < <(ps -eo user=,args= | grep -i 'PM2\[' | grep -v grep || true)
if ((${#others[@]})); then
  printf '    running pm2 daemons:\n'
  printf '      %s\n' "${others[@]}"
fi
for h in /root/.pm2 /home/*/.pm2; do
  [[ -d "$h" ]] || continue
  if [[ "$h" == "$PM2_HOME_DIR" ]]; then continue; fi
  if [[ -f "$h/dump.pm2" ]]; then
    names="$(grep -o '"name":"[^"]*"' "$h/dump.pm2" 2>/dev/null | cut -d'"' -f4 | tr '\n' ' ' || true)"
    ok "separate pm2 home $h holds: ${names:-（unreadable）} — untouched by this script"
    if [[ -n "$names" ]] && grep -qw "$PM2_APP" <<<"$names"; then
      die "another pm2 home ($h) already manages an app called '$PM2_APP'. Two daemons would fight over it — rename one before continuing."
    fi
  fi
done
ok "this app uses PM2_HOME=$PM2_HOME_DIR as $APP_USER"

# ── configuration ────────────────────────────────────────────────────────────
say "Checking configuration"
val() { grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\042\047'; }

secret="$(val FUEL_AUTH_SECRET)"
[[ -n "$secret" && ${#secret} -ge 32 ]] || die "FUEL_AUTH_SECRET missing or too short — every page would render and only sign-in would 500"

portal="$(val FUEL_PORTAL_TOKEN)"
[[ -n "$portal" ]] || die "FUEL_PORTAL_TOKEN is empty"
[[ "$portal" == REPLACE_WITH_* ]] && die "FUEL_PORTAL_TOKEN is still the placeholder — set it to WorkshopOne's SERVICE_PLANNER_TOKEN"
ok "FUEL_AUTH_SECRET and FUEL_PORTAL_TOKEN are set"

grep -q "^DATABASE_URL=\"file:${DATA_DIR}/app.db\"" .env \
  || warn "DATABASE_URL does not point at ${DATA_DIR}/app.db — the Prisma CLI would edit a different file from the app"

ws="$(val WORKSHOP_DB_PATH || true)"
if [[ -n "$ws" ]]; then
  if sudo -u "$APP_USER" test -r "$ws"; then ok "WorkshopOne snapshot readable at $ws"
  else warn "WORKSHOP_DB_PATH=$ws is not readable by $APP_USER — the service sync will fail every 5 minutes"; fi
else
  ok "WORKSHOP_DB_PATH unset — service sync idle"
fi

# ── schema ───────────────────────────────────────────────────────────────────
say "Migration status (read-only)"
set +e
status="$(asuser env DATABASE_URL="file:${DATA_DIR}/app.db" npx prisma migrate status 2>&1)"
set -e
echo "$status" | sed 's/^/    /'
if echo "$status" | grep -qi "Database schema is up to date"; then
  ok "nothing to apply"
elif echo "$status" | grep -qi "not yet been applied"; then
  warn "migrations are pending"
  read -r -p "$(printf '\033[1;33m    apply them now? [y/N] \033[0m')" reply
  if [[ "$reply" =~ ^[Yy]$ ]]; then
    ts="$(date +%Y%m%d-%H%M%S)"
    sudo -u "$APP_USER" sqlite3 "$DATA_DIR/app.db" ".backup '${DATA_DIR}/app.db.pre-migrate-${ts}'"
    ok "backup taken: ${DATA_DIR}/app.db.pre-migrate-${ts}"
    asuser env DATABASE_URL="file:${DATA_DIR}/app.db" npx prisma migrate deploy
    ok "applied"
  else
    warn "skipped — the app may fail at runtime if the schema is behind the code"
  fi
else
  warn "could not read migration status cleanly; continuing"
fi

# ── build ────────────────────────────────────────────────────────────────────
say "Building"
# ALLOWED_ORIGINS is baked into the server bundle at build time, so a
# next.config.ts change is not picked up by a restart alone.
asuser env NODE_ENV=production npm run build
ok "built"

# ── start ────────────────────────────────────────────────────────────────────
say "Starting under PM2 (as $APP_USER, PM2_HOME=$PM2_HOME_DIR)"
if pm2do describe "$PM2_APP" >/dev/null 2>&1; then
  pm2do restart "$PM2_APP" --update-env >/dev/null
  ok "restarted"
else
  pm2do start deploy/ecosystem.config.js >/dev/null
  ok "started"
fi

# `pm2 save` writes OUR dump.pm2 only, because PM2_HOME is ours. This is the
# call that would have been dangerous under a shared home.
pm2do save >/dev/null
ok "boot list saved to $PM2_HOME_DIR/dump.pm2"

# Installs pm2-fuelapp.service, which cannot collide with pm2-root.service or
# whatever unit WorkshopOne uses.
startup_cmd="$(pm2do startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" 2>/dev/null | grep -E '^sudo env' || true)"
if [[ -n "$startup_cmd" ]]; then
  eval "${startup_cmd#sudo }"
  ok "pm2-${APP_USER}.service installed — survives reboot"
else
  warn "could not read the pm2 startup command; run it by hand if you need boot persistence"
fi

# ── prove it serves ──────────────────────────────────────────────────────────
say "Health check"
code=""
for _ in $(seq 1 25); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/login" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
if [[ "$code" != "200" ]]; then
  pm2do logs "$PM2_APP" --lines 40 --nostream || true
  die "app did not answer on 127.0.0.1:${PORT} (last code: ${code:-none})"
fi
ok "http://127.0.0.1:${PORT}/login -> 200"

# A portal-token mismatch is completely silent on this side, so prove it rather
# than hope.
pcode="$(curl -s -o /dev/null -w '%{http_code}' -H "x-portal-token: ${portal}" "http://127.0.0.1:${PORT}/api/portal/summary" || true)"
if [[ "$pcode" == "200" ]]; then ok "portal endpoint accepts the configured token (200)"
else warn "portal endpoint returned ${pcode} — WorkshopOne's calls will fail the same way"; fi

# Confirm the incumbent survived this deploy. Say it now, not tomorrow.
wcode="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:${WORKSHOP_PORT}/" || echo "no-answer")"
if [[ "$wcode" == "no-answer" ]]; then
  warn "WorkshopOne on :${WORKSHOP_PORT} did not answer — CHECK IT before you walk away"
else
  ok "WorkshopOne on :${WORKSHOP_PORT} still answering (${wcode})"
fi

echo
echo "Manage it with:"
echo "  sudo -u ${APP_USER} PM2_HOME=${PM2_HOME_DIR} ${NODE_PREFIX}/bin/npx pm2 status"
echo "  sudo -u ${APP_USER} PM2_HOME=${PM2_HOME_DIR} ${NODE_PREFIX}/bin/npx pm2 logs ${PM2_APP}"
echo
echo "Running on loopback only. Not reachable from the internet until nginx is"
echo "configured — see deploy/README.md."
