#!/usr/bin/env bash
# =============================================================================
#  Build and start (or restart) the app under PM2.
#
#      sudo bash deploy/start-app.sh
#
#  Safe to re-run — this is also the "apply an update" script once the server is
#  live. It never touches the database.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-fuelapp}"
APP_DIR="${APP_DIR:-/var/www/fuelsystem}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
PM2_APP="${PM2_APP:-fuelsystem}"
PORT="${PORT:-3300}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -f "$APP_DIR/.env" ]] || die "$APP_DIR/.env missing — run deploy/bootstrap.sh first"
[[ -f "$DATA_DIR/app.db" ]] || die "$DATA_DIR/app.db missing — run deploy/install-db.sh first"

cd "$APP_DIR"

# ── the .env must actually be usable ─────────────────────────────────────────
say "Checking configuration"
grep -q 'PASTE' .env && die ".env still contains a placeholder"
secret="$(grep -E '^FUEL_AUTH_SECRET=' .env | cut -d= -f2- | tr -d '"')"
[[ -n "$secret" ]] || die "FUEL_AUTH_SECRET is empty — sign-in will 500 while every page renders fine"
[[ ${#secret} -ge 32 ]] || die "FUEL_AUTH_SECRET is suspiciously short (${#secret} chars)"
grep -q "^DATABASE_URL=\"file:${DATA_DIR}/app.db\"" .env || warn "DATABASE_URL does not point at ${DATA_DIR}/app.db — the Prisma CLI will edit a different file from the app"
ok "configuration looks sane"

# ── schema ───────────────────────────────────────────────────────────────────
say "Migration status (read-only)"
set +e
status="$(sudo -u "$APP_USER" env DATABASE_URL="file:${DATA_DIR}/app.db" npx prisma migrate status 2>&1)"
set -e
echo "$status" | sed 's/^/    /'
if echo "$status" | grep -qi "Database schema is up to date"; then
  ok "nothing to apply"
elif echo "$status" | grep -qi "following migration.*not yet been applied\|have not yet been applied"; then
  warn "migrations are pending"
  read -r -p "$(printf '\033[1;33m    apply them now? [y/N] \033[0m')" reply
  if [[ "$reply" =~ ^[Yy]$ ]]; then
    ts="$(date +%Y%m%d-%H%M%S)"
    # Never migrate without a backup taken first — a failed migration on SQLite
    # can leave a partially-applied schema that is far harder to unpick than a
    # restore.
    sudo -u "$APP_USER" sqlite3 "$DATA_DIR/app.db" ".backup '${DATA_DIR}/app.db.pre-migrate-${ts}'"
    ok "backup taken: ${DATA_DIR}/app.db.pre-migrate-${ts}"
    sudo -u "$APP_USER" env DATABASE_URL="file:${DATA_DIR}/app.db" npx prisma migrate deploy
    ok "migrations applied"
  else
    warn "skipped — the app may fail at runtime if the schema is behind the code"
  fi
else
  warn "could not read migration status cleanly; continuing"
fi

# ── build ────────────────────────────────────────────────────────────────────
say "Building"
# ALLOWED_ORIGINS is baked into the server bundle at build time. A pm2 restart
# alone does not pick up a next.config.ts change — it must be rebuilt.
sudo -u "$APP_USER" env NODE_ENV=production npm run build
ok "built"

# ── start ────────────────────────────────────────────────────────────────────
say "Starting under pm2"
if sudo -u "$APP_USER" pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  sudo -u "$APP_USER" pm2 restart "$PM2_APP" --update-env
  ok "restarted"
else
  # --cwd matters: the app resolves .env and relative paths from it.
  sudo -u "$APP_USER" pm2 start npm --name "$PM2_APP" --cwd "$APP_DIR" -- start
  ok "started"
fi
sudo -u "$APP_USER" pm2 save >/dev/null
# Survive a reboot. `pm2 startup` prints a command that must run as root; doing
# it here rather than leaving it as a manual step people forget.
startup_cmd="$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}" 2>/dev/null | grep '^sudo' || true)"
if [[ -n "$startup_cmd" ]]; then
  eval "${startup_cmd#sudo }"
  ok "pm2 will restart on boot"
fi

# ── prove it is actually serving ─────────────────────────────────────────────
say "Health check"
for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/login" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
if [[ "$code" == "200" ]]; then
  ok "http://127.0.0.1:${PORT}/login -> 200"
else
  sudo -u "$APP_USER" pm2 logs "$PM2_APP" --lines 40 --nostream || true
  die "app did not answer on 127.0.0.1:${PORT} (last code: ${code:-none})"
fi

echo
echo "The app is up on loopback. It is NOT reachable from the internet until"
echo "nginx is configured — see deploy/README.md."
