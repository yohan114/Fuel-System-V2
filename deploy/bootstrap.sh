#!/usr/bin/env bash
# =============================================================================
#  E&C Fuel System — first-time server bootstrap
#  Target: fresh Ubuntu 22.04 / 24.04 on 20.204.51.43
#
#  Run as a user with sudo:
#      curl -fsSL https://raw.githubusercontent.com/yohan114/Fuel-System-V2/main/deploy/bootstrap.sh -o bootstrap.sh
#      less bootstrap.sh          # read it before running it
#      sudo bash bootstrap.sh
#
#  Idempotent: safe to re-run. Every step checks before it acts and says what it
#  found. Nothing here touches the database — that is carried separately and
#  installed by deploy/install-db.sh, so a re-run can never destroy live data.
#
#  What it does NOT do, on purpose:
#    * does not generate TLS certificates (Cloudflare sits in front — see
#      deploy/README.md, the choice is yours and it is not idempotent)
#    * does not start the app (no database yet)
#    * does not open SSH to the world or change your SSH config
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-fuelapp}"
APP_DIR="${APP_DIR:-/var/www/fuelsystem}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fuel-system}"
REPO="${REPO:-https://github.com/yohan114/Fuel-System-V2.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-24}"
PORT="${PORT:-3300}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

# ── 1. base packages ─────────────────────────────────────────────────────────
say "Base packages"
apt-get update -qq
# sqlite3 is not optional: scripts/deploy-to-vps.sh silently degrades from a
# safe .backup to a plain cp without it, which on a WAL database can copy a
# torn file. build-essential + python3 + pkg-config are needed to compile
# better-sqlite3 if no prebuilt binary matches this kernel.
apt-get install -y -qq curl ca-certificates git sqlite3 build-essential python3 \
  pkg-config nginx ufw rsync unattended-upgrades jq >/dev/null
ok "installed"

# ── 2. timezone ──────────────────────────────────────────────────────────────
say "Timezone"
# Billing derives day keys from server-local time in several places
# (src/lib/assignments.ts, src/lib/breakdowns.ts). On a UTC host every day
# boundary shifts by 5.5 hours and fuel issued after 18:30 lands on the wrong
# day — which silently moves it into the wrong invoice month.
current_tz="$(timedatectl show -p Timezone --value)"
if [[ "$current_tz" != "Asia/Colombo" ]]; then
  timedatectl set-timezone Asia/Colombo
  ok "set to Asia/Colombo (was $current_tz)"
else
  ok "already Asia/Colombo"
fi

# ── 3. node ──────────────────────────────────────────────────────────────────
say "Node ${NODE_MAJOR}"
have_node="$(node -v 2>/dev/null || true)"
if [[ "$have_node" == v${NODE_MAJOR}.* ]]; then
  ok "already $have_node"
else
  # Prisma 7.8 requires ^20.19 || ^22.12 || >=24. Node 24 matches the
  # workstation this was tested on, so the better-sqlite3 ABI is identical.
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  ok "installed $(node -v)"
fi
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null
ok "pm2 $(pm2 -v)"

# ── 4. app user ──────────────────────────────────────────────────────────────
say "Application user: ${APP_USER}"
# One identity owns the app, the database, the .env and the backups. Mixed
# ownership on a WAL database is the classic "attempt to write a readonly
# database" — SQLite needs to create app.db-wal and app.db-shm beside the file,
# so the DIRECTORY must be writable, not just the .db.
if id -u "$APP_USER" >/dev/null 2>&1; then
  ok "exists"
else
  useradd -m -d "/home/${APP_USER}" -s /bin/bash "$APP_USER"
  ok "created"
fi

if pm2 list >/dev/null 2>&1 && pm2 jlist 2>/dev/null | jq -e 'length > 0' >/dev/null 2>&1; then
  warn "pm2 already manages apps as $(whoami) — check 'pm2 list'; do not run two pm2 daemons for one box"
fi

# ── 5. directories ───────────────────────────────────────────────────────────
say "Directories"
mkdir -p "$APP_DIR" "$DATA_DIR/uploads" "$BACKUP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"
ok "$APP_DIR"
ok "$DATA_DIR (0750, $APP_USER)"
ok "$BACKUP_DIR (0750, $APP_USER)"

# ── 6. code ──────────────────────────────────────────────────────────────────
say "Code"
if [[ -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch origin --quiet
  sudo -u "$APP_USER" git -C "$APP_DIR" checkout -q "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH" --quiet
  ok "updated to $(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --short HEAD)"
else
  sudo -u "$APP_USER" git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
  ok "cloned at $(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --short HEAD)"
fi

# The whole point of the untrack commit: a database must never arrive by pull.
if [[ -f "$APP_DIR/data/app.db" ]]; then
  die "$APP_DIR/data/app.db exists — the repo is still shipping a database. Stop and re-check Part A step 2."
fi
ok "no database inside the tree (correct)"

# ── 7. .env ──────────────────────────────────────────────────────────────────
say "Environment file"
# Generated HERE so secrets never travel over scp, email or a chat window.
# Written once and never overwritten: regenerating FUEL_AUTH_SECRET signs every
# existing session cookie invalid and logs the whole company out.
if [[ -f "$APP_DIR/.env" ]]; then
  ok ".env exists — left untouched (delete it by hand if you truly want new secrets)"
else
  gen() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
  admin_pw="$(gen 12)"
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
TZ=Asia/Colombo
PORT=${PORT}

# Absolute, and BOTH names: the app reads FUEL_DATABASE_URL (src/lib/db.ts),
# the Prisma CLI reads only DATABASE_URL (prisma.config.ts). Same value, so
# they cannot drift and edit different databases.
DATABASE_URL="file:${DATA_DIR}/app.db"
FUEL_DATABASE_URL="file:${DATA_DIR}/app.db"

# src/lib/auth-secret.ts throws in production when this is unset or still the
# dev fallback — but lazily, so the site boots and /login renders and only the
# sign-in POST 500s. Set it now, not after the first support call.
FUEL_AUTH_SECRET="$(gen 48)"
CRON_SECRET="$(gen 32)"
FUEL_PORTAL_TOKEN="$(gen 32)"
SEED_ADMIN_PASSWORD="${admin_pw}"

UPLOADS_DIR=${DATA_DIR}/uploads
BACKUP_DIR=${BACKUP_DIR}

# WorkshopOne runs on another host; leave unset so the sync stays idle rather
# than polling a path that does not exist here.
# WORKSHOP_DB_PATH=
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  ok "created, mode 600, owner $APP_USER"
  printf '\033[1;33m    SEED_ADMIN_PASSWORD = %s\033[0m\n' "$admin_pw"
  printf '\033[1;33m    ^ copy this now; it is only used if you seed a fresh admin\033[0m\n'
fi

# ── 8. firewall ──────────────────────────────────────────────────────────────
say "Firewall"
# Deliberately NOT enabling ufw here. Enabling a default-deny firewall over an
# SSH session locks you out if the allow rule is wrong, and this script may be
# running on a box whose SSH port is not 22. Rules are staged; you enable it.
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp   >/dev/null 2>&1 || true
ufw allow 443/tcp  >/dev/null 2>&1 || true
if ufw status | grep -q "Status: active"; then
  ok "already active"
else
  warn "rules staged but ufw is INACTIVE — enable it yourself once SSH is confirmed: sudo ufw enable"
fi
# 3300 must never be world-reachable; nginx proxies to it over loopback.
ufw deny "${PORT}/tcp" >/dev/null 2>&1 || true
ok "port ${PORT} denied from outside (nginx proxies over loopback)"

# ── 9. dependencies and build ────────────────────────────────────────────────
say "Dependencies"
# better-sqlite3 is native. A Windows node_modules copied here throws an
# invalid-ELF-header error on every page; it must be built on this box.
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --no-audit --no-fund
so="$APP_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[[ -f "$so" ]] || die "better-sqlite3 native binary missing"
file "$so" | grep -q "ELF 64-bit" || die "better-sqlite3 is not a Linux binary: $(file -b "$so")"
ok "better-sqlite3 is a Linux ELF binary"
sudo -u "$APP_USER" npx prisma generate >/dev/null
ok "prisma client generated"

say "Bootstrap complete"
cat <<EOF

Next, in order:

  1. Carry the database up (from the workstation):
         scp data/app-ship.db <you>@20.204.51.43:/tmp/app-ship.db
     then on this box:
         sudo bash ${APP_DIR}/deploy/install-db.sh /tmp/app-ship.db

  2. Build and start:
         sudo bash ${APP_DIR}/deploy/start-app.sh

  3. Web server and TLS — read ${APP_DIR}/deploy/README.md first.
     Your DNS is proxied through Cloudflare, so the TLS step is NOT the
     plain certbot run the generic guides give you.

Nothing is serving yet. That is expected: there is no database.
EOF
