#!/usr/bin/env bash
# =============================================================================
#  Build and start (or restart) the fuel system under systemd.
#
#      sudo bash deploy/start-app.sh
#
#  This is also the update script once the server is live. Safe to re-run, and
#  it never touches the database.
#
#  It touches nothing belonging to WorkshopOne: its own systemd unit, its own
#  Node at /opt/node-24, its own user. No PM2, so there is no shared dump file
#  to overwrite.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-fuelapp}"
APP_DIR="${APP_DIR:-/var/www/fuelsystem}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
NODE_PREFIX="${NODE_PREFIX:-/opt/node-24}"
UNIT="${UNIT:-fuelsystem}"
PORT="${PORT:-3300}"
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
asuser() { sudo -u "$APP_USER" env PATH="$NODE_PATH_ENV" "$@"; }

# ── configuration ────────────────────────────────────────────────────────────
say "Checking configuration"
# Octal escapes for " and ' rather than trying to quote them inline — the
# shell-quoting dance for a literal single quote inside single quotes is exactly
# how the previous version of this line ended up unbalanced.
val() { grep -E "^${1}=" .env | tail -1 | cut -d= -f2- | tr -d '\042\047'; }

secret="$(val FUEL_AUTH_SECRET)"
[[ -n "$secret" && ${#secret} -ge 32 ]] || die "FUEL_AUTH_SECRET missing or too short — every page would render and only sign-in would 500"

# The shared secret with WorkshopOne. A placeholder here means WorkshopOne gets
# 401 from every /api/portal/* call, silently, and its panels stop updating.
portal="$(val FUEL_PORTAL_TOKEN)"
[[ -n "$portal" ]] || die "FUEL_PORTAL_TOKEN is empty"
[[ "$portal" == REPLACE_WITH_* ]] && die "FUEL_PORTAL_TOKEN is still the placeholder — set it to WorkshopOne's SERVICE_PLANNER_TOKEN"
ok "FUEL_AUTH_SECRET and FUEL_PORTAL_TOKEN are set"

grep -q "^DATABASE_URL=\"file:${DATA_DIR}/app.db\"" .env \
  || warn "DATABASE_URL does not point at ${DATA_DIR}/app.db — the Prisma CLI would edit a different file from the app"

# If the sync is pointed at a snapshot, the snapshot has to exist and be
# readable, or the 5-minute poller logs a failure forever.
ws="$(val WORKSHOP_DB_PATH || true)"
if [[ -n "$ws" ]]; then
  if sudo -u "$APP_USER" test -r "$ws"; then
    ok "WorkshopOne snapshot readable at $ws"
  else
    warn "WORKSHOP_DB_PATH=$ws is not readable by $APP_USER — the service sync will fail every 5 minutes"
  fi
else
  ok "WORKSHOP_DB_PATH unset — service sync idle (set it once the snapshot cron is in place)"
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

# ── unit ─────────────────────────────────────────────────────────────────────
say "systemd unit"
if [[ ! -f /etc/systemd/system/${UNIT}.service ]] || ! cmp -s "deploy/${UNIT}.service" "/etc/systemd/system/${UNIT}.service"; then
  install -m 0644 "deploy/${UNIT}.service" "/etc/systemd/system/${UNIT}.service"
  systemctl daemon-reload
  ok "unit installed/updated"
else
  ok "unit already current"
fi
systemctl enable "$UNIT" >/dev/null 2>&1 || true

say "Restarting"
systemctl restart "$UNIT"
ok "restart issued"

# ── prove it serves ──────────────────────────────────────────────────────────
say "Health check"
code=""
for _ in $(seq 1 25); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/login" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
if [[ "$code" != "200" ]]; then
  journalctl -u "$UNIT" -n 40 --no-pager || true
  die "app did not answer on 127.0.0.1:${PORT} (last code: ${code:-none})"
fi
ok "http://127.0.0.1:${PORT}/login -> 200"

# The portal token is the one thing a mismatch of which is completely silent.
# Prove it works rather than hoping.
pcode="$(curl -s -o /dev/null -w '%{http_code}' -H "x-portal-token: ${portal}" "http://127.0.0.1:${PORT}/api/portal/summary" || true)"
if [[ "$pcode" == "200" ]]; then
  ok "portal endpoint accepts the configured token (200)"
else
  warn "portal endpoint returned ${pcode} for the configured token — WorkshopOne's calls will fail the same way"
fi

# Confirm the incumbent is still up. If this deploy broke it, say so now rather
# than letting it be discovered tomorrow.
wcode="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:1929/" || echo "no-answer")"
if [[ "$wcode" == "no-answer" ]]; then
  warn "WorkshopOne on :1929 did not answer — CHECK IT before you walk away"
else
  ok "WorkshopOne on :1929 still answering (${wcode})"
fi

echo
echo "Running on loopback only. Not reachable from the internet until nginx is"
echo "configured — see deploy/README.md, and do not delete the default site"
echo "before checking what it serves."
