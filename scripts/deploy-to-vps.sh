#!/usr/bin/env bash
# ==============================================================================
#  E&C Fuel System V2 — safe update for a LIVE server
#
#  data/app.db is tracked in git, so a plain pull would overwrite live operator
#  data. This stops the app, backs the database up cleanly (SQLite WAL is only
#  consistent once the last connection closes), takes the new code, restores the
#  live database, migrates, syncs fuel, rebuilds June, then starts the app again.
#
#  Because the live database is deliberately kept, fuel imported on a workstation
#  does not arrive with the code — it is carried in
#  data/fuel-data-export.json and replayed additively by the fuel sync step.
#
#  Only the PM2 process named below is touched — other apps on the box are left
#  running.
#
#  Usage:   cd /var/www/fuelsystem
#           bash scripts/deploy-to-vps.sh
# ==============================================================================
set -euo pipefail

BRANCH="${BRANCH:-claude/wonderful-hypatia-yi703x}"
PM2_APP="${PM2_APP:-fuelsystem}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${HOME}/fuel-db-backups"
BACKUP="${BACKUP_DIR}/app.db.live.${STAMP}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    OK  %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !   %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }
confirm() {
  read -r -p "$(printf '\033[1;33m%s [y/N] \033[0m' "$1")" reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Cancelled by user — nothing was changed."
}

APP_STOPPED=0
start_app() {
  if [[ "$APP_STOPPED" == "1" ]]; then
    pm2 start "$PM2_APP" >/dev/null 2>&1 || pm2 restart "$PM2_APP" >/dev/null 2>&1 || true
    APP_STOPPED=0
  fi
}
# If anything fails after the app was stopped, bring it back up rather than
# leaving the site down.
trap 'rc=$?; if [[ $rc -ne 0 ]]; then printf "\n\033[1;31mError — restarting %s, database left as-is.\033[0m\n" "$PM2_APP"; start_app; printf "Backup (if taken): %s\n" "$BACKUP"; fi' EXIT

# ---------------------------------------------------------------- sanity checks
say "Checking environment"
[[ -f package.json && -f prisma/schema.prisma ]] || die "Run this from the app folder (package.json + prisma/schema.prisma not found)."
[[ -d .git ]] || die "Not a git repository."
command -v node >/dev/null || die "node is not installed"
command -v pm2  >/dev/null || warn "pm2 not found — will skip stop/start"
ok "$(pwd) · node $(node -v) · npm $(npm -v)"

if command -v pm2 >/dev/null; then
  pm2 describe "$PM2_APP" >/dev/null 2>&1 || die "PM2 app '$PM2_APP' not found. Set PM2_APP=<name> and re-run."
  ok "PM2 target: $PM2_APP (other PM2 apps will NOT be touched)"
fi

# ------------------------------------------------------ stop app, then back up
# SQLite in WAL mode keeps recent writes in data/app.db-wal. Copying app.db
# while the app holds it open can miss those writes, so stop first.
say "Stopping $PM2_APP so the database can be copied consistently"
warn "The fuel system will be OFFLINE for a few minutes (other apps keep running)."
confirm "Stop $PM2_APP and begin the update?"
if command -v pm2 >/dev/null; then
  pm2 stop "$PM2_APP" >/dev/null
  APP_STOPPED=1
  sleep 2
  ok "$PM2_APP stopped"
fi

say "Backing up the LIVE database"
[[ -f data/app.db ]] || die "data/app.db not found."
mkdir -p "$BACKUP_DIR"
if command -v sqlite3 >/dev/null; then
  # Online-backup API folds any remaining WAL content into one clean file.
  sqlite3 data/app.db ".backup '${BACKUP}'" || die "sqlite3 backup failed"
  ok "backed up with sqlite3 .backup (WAL included)"
else
  cp data/app.db "$BACKUP"
  [[ -f data/app.db-wal ]] && cp data/app.db-wal "${BACKUP}-wal" && warn "copied -wal sidecar too"
  [[ -f data/app.db-shm ]] && cp data/app.db-shm "${BACKUP}-shm"
  ok "backed up by file copy"
fi
[[ -s "$BACKUP" ]] || die "Backup is empty — aborting before any change."
ok "$BACKUP ($(du -h "$BACKUP" | cut -f1))"

echo "    Live data in that backup:"
npx tsx -e '
import { prisma } from "./src/lib/db";
(async () => {
  const [f,u,b,a] = await Promise.all([
    prisma.fuelIssue.count(), prisma.user.count(), prisma.bill.count(), prisma.asset.count(),
  ]);
  console.log(`      fuel issues ${f} · users ${u} · bills ${b} · assets ${a}`);
  await prisma.$disconnect();
})();' 2>/dev/null | grep -v "^prisma:query" || warn "(could not read counts — continuing)"

# --------------------------------------------------------------- take new code
say "Updating code to ${BRANCH}"
git fetch origin "$BRANCH"
echo "    incoming commits:"; git log --oneline "HEAD..origin/$BRANCH" | sed 's/^/      /' || true
confirm "Replace the code with origin/${BRANCH}? (your database is restored right after)"
git checkout -f -B "$BRANCH" "origin/$BRANCH"
ok "now at $(git log --oneline -1)"

# ------------------------------------------------------------ restore live data
say "Restoring YOUR live database over the repo's copy"
cp "$BACKUP" data/app.db
# Any WAL/SHM left from before belongs to the OLD file; a stale WAL replayed
# over a restored database corrupts it.
rm -f data/app.db-wal data/app.db-shm
ok "live database restored, stale WAL/SHM cleared"

# -------------------------------------------------------- dependencies + schema
say "Installing dependencies"
npm ci
npx prisma generate
ok "dependencies ready"

say "Applying migrations (additive — nothing is dropped)"
DATABASE_URL="file:./data/app.db" npx prisma migrate deploy
ok "schema up to date"

# ----------------------------------------------------------------- fuel sync
# Because the live database was just restored over the repo's copy, fuel
# imported on a workstation is NOT on this server yet. It travels as data
# (data/fuel-data-export.json) and is replayed here. Purely additive: rows the
# operators entered are never touched, and re-running adds nothing.
#
# Runs BEFORE the billing rebuild — bills are generated from fuel issues, so the
# fuel has to be in place first.
#
# Carries issues, replenishment requests and meter readings. Vehicles missing
# from this server are skipped and listed; re-run with FUEL_CREATE_ASSETS=1 to
# have them created from the export instead.
#
# Tank stock is reported but never overwritten by default — a balance is a
# single current number, so taking the export's figure would discard whatever
# this server has pumped since. Set FUEL_ADOPT_BALANCES=1 only when the export
# is the authority on stock levels.
FUEL_EXPORT="data/fuel-data-export.json"
if [[ -f "$FUEL_EXPORT" ]]; then
  SYNC_FLAGS=""
  [[ "${FUEL_CREATE_ASSETS:-0}" == "1" ]] && SYNC_FLAGS="$SYNC_FLAGS --create-missing-assets" \
    && warn "FUEL_CREATE_ASSETS=1 — vehicles missing here will be created"
  [[ "${FUEL_ADOPT_BALANCES:-0}" == "1" ]] && SYNC_FLAGS="$SYNC_FLAGS --adopt-balances" \
    && warn "FUEL_ADOPT_BALANCES=1 — tank stock will be overwritten from the export"

  say "Fuel sync — DRY RUN (nothing written)"
  npx tsx scripts/import_fuel_data.ts $SYNC_FLAGS 2>&1 | grep -v "^prisma:query"
  echo
  confirm "Add the fuel issues listed above to the live database?"
  npx tsx scripts/import_fuel_data.ts --apply $SYNC_FLAGS 2>&1 | grep -v "^prisma:query"
  ok "fuel sync complete"
else
  warn "$FUEL_EXPORT not found — skipping fuel sync"
fi

# ------------------------------------------------------------- billing rebuild
say "June 2026 rebuild — DRY RUN (nothing written)"
npx tsx scripts/deploy_june_rebuild.ts 2>&1 | grep -v "^prisma:query"
echo
confirm "Apply the June rebuild shown above?"
npx tsx scripts/deploy_june_rebuild.ts --apply 2>&1 | grep -v "^prisma:query"

# ------------------------------------------------------------- build + restart
say "Building"
npm run build
ok "build complete"

say "Starting $PM2_APP"
if command -v pm2 >/dev/null; then
  pm2 start "$PM2_APP" >/dev/null 2>&1 || pm2 restart "$PM2_APP" >/dev/null
  APP_STOPPED=0
  pm2 save >/dev/null 2>&1 || true
  sleep 3
  pm2 describe "$PM2_APP" | grep -E "status|uptime" | head -2 || true
  ok "$PM2_APP running"
else
  warn "pm2 not available — start the app yourself"
fi

trap - EXIT
say "DONE"
echo "    Backup:   $BACKUP"
echo "    Rollback: pm2 stop $PM2_APP && cp \"$BACKUP\" data/app.db && rm -f data/app.db-wal data/app.db-shm && pm2 start $PM2_APP"
echo
