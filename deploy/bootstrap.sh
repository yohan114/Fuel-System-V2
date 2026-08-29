#!/usr/bin/env bash
# =============================================================================
#  E&C Fuel System — bootstrap onto a SHARED server
#  Target: 20.204.51.43, which ALREADY RUNS WorkshopOne on :1929
#
#      sudo bash deploy/survey-server.sh      # FIRST. read the summary.
#      sudo bash deploy/bootstrap.sh
#
#  This box is not empty, and that changes almost every decision here. The
#  guiding rule: the fuel system brings its own everything and touches nothing
#  the incumbent depends on.
#
#  What that means in practice, and what an earlier version of this script got
#  wrong:
#
#    * Node is installed PRIVATELY at /opt/node-24. There is exactly one
#      /usr/bin/node on Ubuntu, and replacing it re-points every Node app on the
#      machine. WorkshopOne reads SQLite, so it has a compiled native addon
#      built against one NODE_MODULE_VERSION; swapping the interpreter under it
#      does not fail at upgrade time — it fails at its next restart, days later,
#      with "Module did not self-register".
#
#    * The app runs under SYSTEMD, not PM2. PM2 keeps one mutable dump.pm2 per
#      PM2_HOME and `pm2 save` overwrites it wholesale. If WorkshopOne shares
#      that home, a fuel deploy can silently delete it from the boot list.
#      A systemd unit has no shared mutable state.
#
#    * nginx is installed only if ABSENT. `apt-get install nginx` on a box that
#      already has it is an upgrade, and the postinst restarts it for both apps.
#
#    * The MACHINE timezone is left alone. The app gets TZ=Asia/Colombo in its
#      own unit. Changing it system-wide moves every existing cron and timer.
#
#    * ufw and unattended-upgrades are NOT introduced. Automatic patching with
#      automatic restarts is the host owner's decision, and it is the most
#      likely thing to detonate a latent fault at 03:00.
#
#  Idempotent. Safe to re-run. Does not touch the database.
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-fuelapp}"
APP_DIR="${APP_DIR:-/var/www/fuelsystem}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fuel-system}"
REPO="${REPO:-https://github.com/yohan114/Fuel-System-V2.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-24}"
NODE_VER="${NODE_VER:-24.12.0}"          # pinned; do not track "latest"
NODE_PREFIX="/opt/node-${NODE_MAJOR}"
PORT="${PORT:-3300}"
WORKSHOP_PORT="${WORKSHOP_PORT:-1929}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"

# ── 0. pre-flight: this box is NOT empty ─────────────────────────────────────
say "Pre-flight"
if [[ ! -f /root/.fuel-preflight-ack ]]; then
  warn "This server already runs WorkshopOne on :${WORKSHOP_PORT}."
  warn "Run deploy/survey-server.sh first and read its SUMMARY block."
  read -r -p "$(printf '\033[1;33m    type SHARED once you have surveyed this box: \033[0m')" r
  [[ "$r" == "SHARED" ]] || die "stopped — survey the box first"
  touch /root/.fuel-preflight-ack
fi

# Another web server owning :80 would make the nginx step meaningless.
for s in apache2 caddy lighttpd httpd; do
  systemctl is-active --quiet "$s" 2>/dev/null && die "$s is running and owns :80 — decide which web server fronts both apps before continuing"
done

if ss -lntH "sport = :${PORT}" 2>/dev/null | grep -q .; then
  ss -lntpH "sport = :${PORT}" | sed 's/^/      /'
  die "port ${PORT} is already in use — resolve this before continuing"
fi
ok "port ${PORT} is free"

if ss -lntH "sport = :${WORKSHOP_PORT}" 2>/dev/null | grep -q .; then
  ok "WorkshopOne is listening on :${WORKSHOP_PORT} (as expected)"
else
  warn "nothing is listening on :${WORKSHOP_PORT} — is WorkshopOne actually running?"
fi

say "Externally-reachable listeners — a firewall change would orphan these"
ss -lntupH 2>/dev/null | grep -vE '127\.0\.0\.1:|\[::1\]:' | sed 's/^/      /' || true

# ── 1. packages ──────────────────────────────────────────────────────────────
say "Packages"
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update -qq
# Inert build and runtime tooling only. sqlite3 is not optional — the deploy
# and backup paths degrade from a safe .backup to a plain cp without it, and on
# a WAL database a cp can copy a torn file.
apt-get install -y -qq -o Dpkg::Options::=--force-confold \
  curl ca-certificates git sqlite3 build-essential python3 pkg-config rsync jq >/dev/null
ok "build tooling installed"

if dpkg -s nginx >/dev/null 2>&1; then
  ok "nginx already present ($(nginx -v 2>&1 | sed 's/.*\///')) — NOT upgraded, NOT restarted"
else
  apt-get install -y -qq -o Dpkg::Options::=--force-confold nginx >/dev/null
  ok "nginx installed (was absent)"
fi

dpkg -s ufw >/dev/null 2>&1 || warn "ufw not installed — not introducing one; use the Azure NSG instead"
# unattended-upgrades deliberately not installed. See the header.

# ── 2. timezone — the app's, not the machine's ───────────────────────────────
say "Timezone"
current_tz="$(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"
if [[ "$current_tz" == "Asia/Colombo" ]]; then
  ok "machine is already Asia/Colombo"
else
  ok "machine left at ${current_tz} — correct on a shared box"
  ok "the fuel app gets TZ=Asia/Colombo in its own systemd unit"
  warn "changing it machine-wide would shift every existing cron and timer, and"
  warn "move WorkshopOne's timestamps the moment it next restarts. Not doing that."
fi

# ── 3. Node, privately ───────────────────────────────────────────────────────
say "Node ${NODE_VER} at ${NODE_PREFIX}"
{ echo "system node before this deploy: $(node -v 2>/dev/null || echo none)"
  echo "at: $(command -v node 2>/dev/null || echo none)"
  dpkg -l nodejs 2>/dev/null | tail -2 || true
} > /root/fuel-deploy-node-before.txt

if [[ -x "${NODE_PREFIX}/bin/node" ]]; then
  ok "private node $("${NODE_PREFIX}/bin/node" -v) already installed"
else
  tmpd="$(mktemp -d)"
  curl -fsSL -o "$tmpd/node.tar.xz" "https://nodejs.org/dist/v${NODE_VER}/node-v${NODE_VER}-linux-x64.tar.xz"
  curl -fsSL -o "$tmpd/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VER}/SHASUMS256.txt"
  # Verify before unpacking. A tarball fetched over the network and unpacked
  # into /opt as root is worth one checksum.
  ( cd "$tmpd" && grep " node-v${NODE_VER}-linux-x64.tar.xz\$" SHASUMS256.txt \
      | sed "s|node-v${NODE_VER}-linux-x64.tar.xz|node.tar.xz|" | sha256sum -c - >/dev/null ) \
    || die "Node tarball checksum mismatch — not unpacking"
  tar -xJf "$tmpd/node.tar.xz" -C /opt
  ln -sfn "/opt/node-v${NODE_VER}-linux-x64" "$NODE_PREFIX"
  rm -rf "$tmpd"
  ok "installed $("${NODE_PREFIX}/bin/node" -v)"
fi
ok "system node untouched: $(node -v 2>/dev/null || echo 'none installed')"
export PATH="${NODE_PREFIX}/bin:$PATH"

# ── 4. app user ──────────────────────────────────────────────────────────────
say "Application user: ${APP_USER}"
if id -u "$APP_USER" >/dev/null 2>&1; then
  ok "exists"
else
  useradd -m -d "/home/${APP_USER}" -s /bin/bash "$APP_USER"
  ok "created"
fi

# ── 5. directories ───────────────────────────────────────────────────────────
say "Directories"
mkdir -p "$APP_DIR" "$DATA_DIR/uploads" "$BACKUP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"
ok "$APP_DIR, $DATA_DIR (0750), $BACKUP_DIR (0750)"

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
[[ -f "$APP_DIR/data/app.db" ]] && die "$APP_DIR/data/app.db exists — a database must never arrive by git pull"
ok "no database inside the tree (correct)"

# ── 7. .env ──────────────────────────────────────────────────────────────────
say "Environment file"
if [[ -f "$APP_DIR/.env" ]]; then
  ok ".env exists — left untouched"
else
  gen() { "${NODE_PREFIX}/bin/node" -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }
  admin_pw="$(gen 12)"
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
TZ=Asia/Colombo
PORT=${PORT}

# Absolute, and BOTH names: the app reads FUEL_DATABASE_URL (src/lib/db.ts), the
# Prisma CLI reads only DATABASE_URL (prisma.config.ts). Same value so they
# cannot drift and edit different databases.
DATABASE_URL="file:${DATA_DIR}/app.db"
FUEL_DATABASE_URL="file:${DATA_DIR}/app.db"

# Ours alone — generated here so they never travel.
FUEL_AUTH_SECRET="$(gen 48)"
CRON_SECRET="$(gen 32)"
SEED_ADMIN_PASSWORD="${admin_pw}"

# SHARED SECRET WITH WORKSHOPONE — DO NOT GENERATE A NEW ONE.
# WorkshopOne calls /api/portal/{costs,entities,service,summary} with this value
# in an x-portal-token header; every one of those routes returns 401 on a
# mismatch, and nothing on this side logs it. WorkshopOne's panels just quietly
# stop updating and it looks like a WorkshopOne bug.
# Set this to WorkshopOne's existing SERVICE_PLANNER_TOKEN, or rotate both sides
# together in one window. start-app.sh refuses to start until it is set.
FUEL_PORTAL_TOKEN="REPLACE_WITH_WORKSHOPONE_SERVICE_PLANNER_TOKEN"

# WorkshopOne is on THIS box, so the service sync can read its database — but
# not the live file. A better-sqlite3 readonly open of a WAL database still has
# to map the -shm sidecar, which needs write permission on the file and its
# directory; granting fuelapp write access into WorkshopOne's data directory is
# not something to do casually. Point this at a snapshot instead, refreshed by
# the cron in deploy/README.md. Leave it commented until that snapshot exists,
# or the sync throws every 5 minutes forever.
# WORKSHOP_DB_PATH=${DATA_DIR}/workshopone-snapshot.db

UPLOADS_DIR=${DATA_DIR}/uploads
BACKUP_DIR=${BACKUP_DIR}
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  ok "created, mode 600, owner $APP_USER"
  printf '\033[1;33m    SEED_ADMIN_PASSWORD = %s   (copy it now)\033[0m\n' "$admin_pw"
  warn "FUEL_PORTAL_TOKEN is a PLACEHOLDER — set it before starting, see the file"
fi

# ── 8. dependencies ──────────────────────────────────────────────────────────
say "Dependencies"
cd "$APP_DIR"
sudo -u "$APP_USER" env PATH="${NODE_PREFIX}/bin:/usr/bin:/bin" npm ci --no-audit --no-fund
so="$APP_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[[ -f "$so" ]] || die "better-sqlite3 native binary missing"
file "$so" | grep -q "ELF 64-bit" || die "better-sqlite3 is not a Linux binary: $(file -b "$so")"
ok "better-sqlite3 built against $("${NODE_PREFIX}/bin/node" -v), ELF 64-bit"
sudo -u "$APP_USER" env PATH="${NODE_PREFIX}/bin:/usr/bin:/bin" npx prisma generate >/dev/null
ok "prisma client generated"

say "Bootstrap complete — nothing of WorkshopOne's was changed"
cat <<EOF

  system node : $(node -v 2>/dev/null || echo 'none') (untouched, recorded in /root/fuel-deploy-node-before.txt)
  fuel node   : $("${NODE_PREFIX}/bin/node" -v) at ${NODE_PREFIX}
  nginx       : $(dpkg -s nginx >/dev/null 2>&1 && echo 'present, not restarted' || echo 'not installed')

Next, in order:

  1. Set FUEL_PORTAL_TOKEN in ${APP_DIR}/.env to WorkshopOne's
     SERVICE_PLANNER_TOKEN. The survey report tells you which file holds it.

  2. Carry the database up, then:
         sudo bash ${APP_DIR}/deploy/install-db.sh /tmp/app-ship.db

  3. Start it:
         sudo bash ${APP_DIR}/deploy/start-app.sh

  4. nginx — read ${APP_DIR}/deploy/README.md. Do NOT delete the default site
     before checking what it serves.
EOF
