#!/usr/bin/env bash
# ==============================================================================
#  E&C Fuel System V2 — safe update for a LIVE server
#
#  Everything here targets the database the APP actually serves, resolved from
#  DATABASE_URL / FUEL_DATABASE_URL / .env — never assumed. On this server that
#  is /var/lib/fuel-system/app.db, outside the repo, while a stale copy also sits
#  at data/app.db; migrating, backing up or importing into the wrong one looks
#  like success while the live site never changes.
#
#  Stops the app, backs the live database up cleanly (SQLite WAL is only
#  consistent once the last connection closes), takes the new code, migrates,
#  syncs fuel, rebuilds June, then starts the app again.
#
#  Fuel imported on a workstation does not arrive with the code — it is carried
#  in data/fuel-data-export.json and replayed additively by the fuel sync step.
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

# The database the running app uses. Checked in the same order src/lib/db.ts
# checks it, so the scripts and the app can never disagree about the target.
resolve_db() {
  local url="${FUEL_DATABASE_URL:-${DATABASE_URL:-}}"
  if [[ -z "$url" && -f .env ]]; then
    url="$(grep -hE '^[[:space:]]*(FUEL_)?DATABASE_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'" | xargs)"
  fi
  [[ -z "$url" ]] && url="file:./data/app.db"
  local f="${url#file:}"
  while [[ "$f" == //* ]]; do f="${f#/}"; done      # file:///abs -> /abs
  if [[ "$f" == /* ]]; then printf '%s' "$f"; else printf '%s/%s' "$(pwd)" "${f#./}"; fi
}

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
LIVE_DB="$(resolve_db)"
echo "    app database: $LIVE_DB"
[[ -f "$LIVE_DB" ]] || die "the app's database was not found at $LIVE_DB — check DATABASE_URL in .env"
if [[ "$LIVE_DB" != "$(pwd)/data/app.db" ]]; then
  ok "live database is outside the repo — git cannot touch it"
fi
mkdir -p "$BACKUP_DIR"
if command -v sqlite3 >/dev/null; then
  # Online-backup API folds any remaining WAL content into one clean file.
  sqlite3 "$LIVE_DB" ".backup '${BACKUP}'" || die "sqlite3 backup failed"
  ok "backed up with sqlite3 .backup (WAL included)"
else
  cp "$LIVE_DB" "$BACKUP"
  [[ -f "${LIVE_DB}-wal" ]] && cp "${LIVE_DB}-wal" "${BACKUP}-wal" && warn "copied -wal sidecar too"
  [[ -f "${LIVE_DB}-shm" ]] && cp "${LIVE_DB}-shm" "${BACKUP}-shm"
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
# Only needed when the live database sits inside the repo, where `git checkout`
# would have just overwritten it with the committed copy. When it lives
# elsewhere — as on this server — git never touched it and copying the backup
# back would be pointless churn on a file the app has open.
if [[ "$LIVE_DB" == "$(pwd)/data/app.db" ]]; then
  say "Restoring YOUR live database over the repo's copy"
  cp "$BACKUP" "$LIVE_DB"
  # Any WAL/SHM left from before belongs to the OLD file; a stale WAL replayed
  # over a restored database corrupts it.
  rm -f "${LIVE_DB}-wal" "${LIVE_DB}-shm"
  ok "live database restored, stale WAL/SHM cleared"
else
  say "Live database untouched by the code update ($LIVE_DB)"
fi

# -------------------------------------------------------- dependencies + schema
say "Installing dependencies"
npm ci
npx prisma generate
ok "dependencies ready"

say "Applying migrations (additive — nothing is dropped)"
# A database whose schema was built by `db push` has the tables but no migration
# history, so deploy replays from the start and dies on the first "table already
# exists". That is bookkeeping, not damage — the diagnosis prints the exact
# resolve commands rather than leaving a bare P3018 to interpret.
if ! DATABASE_URL="file:$LIVE_DB" npx prisma migrate deploy; then
  warn "migrate deploy failed — diagnosing before changing anything else"
  FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/diagnose_migrations.ts 2>&1 | grep -v "^prisma:query" || true
  die "Migrations must be resolved first. Run the commands above, then re-run this script. Your data is untouched; backup: $BACKUP"
fi
ok "schema up to date"

# ------------------------------------------------------- Galagedara stock book
# Runs BEFORE the fuel sync, and this order matters. The workbook REPLACES
# Galagedara's fuel: the site's earlier rows came from partial imports whose
# figures had drifted away from the invoices actually issued against them. The
# fuel sync only ever adds, so it cannot retire those superseded rows — left to
# the sync alone this server would end up holding both sets and double-counting
# the site. Running the importer first retires them; the sync then finds the
# book's rows already present and adds nothing.
#
# Re-running is safe: it replaces its own rows rather than stacking.
GALAGEDARA_BOOK="data/source-sheets/Galagedara_Fuel_Monthly_and_Vehicle_Allocation.xlsx"
if [[ -f "$GALAGEDARA_BOOK" ]]; then
  say "Galagedara stock book — DRY RUN (nothing written)"
  FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/import_galagedara_monthly.ts 2>&1 | grep -v "^prisma:query"
  echo
  confirm "Replace Galagedara's fuel with the stock book shown above?"
  FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/import_galagedara_monthly.ts --apply 2>&1 | grep -v "^prisma:query"
  ok "Galagedara stock book applied"
else
  warn "$GALAGEDARA_BOOK not found — skipping (the fuel sync would then DOUBLE-COUNT this site)"
fi

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
  FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/import_fuel_data.ts $SYNC_FLAGS 2>&1 | grep -v "^prisma:query"
  echo
  confirm "Add the fuel issues listed above to the live database?"
  FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/import_fuel_data.ts --apply $SYNC_FLAGS 2>&1 | grep -v "^prisma:query"
  ok "fuel sync complete"
else
  warn "$FUEL_EXPORT not found — skipping fuel sync"
fi

# --------------------------------------------------- Galagedara alias cleanup
# Runs AFTER the fuel sync, and that order is the whole point. Two Galagedara
# refuels were filed twice, once against the real vehicle and once against the
# plate as it was misread on the sheet — DAG-4929 for DAG-4969, LA-0920 for
# LL-0920 (DT-02). The workbook's own name map states both merges.
#
# The stock-book importer above cannot retire them: it only replaces rows for
# vehicles the workbook names, and these two plates are not in it. The fuel sync
# would happily re-add them from any export taken before the cleanup. Running
# last means the orphans go whatever the earlier steps put back.
#
# Idempotent: on a server that never had them it deletes nothing.
say "Galagedara alias cleanup — DRY RUN (nothing written)"
FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/fix_galagedara_aliases.ts 2>&1 | grep -v "^prisma:query"
echo
confirm "Remove the duplicate rows listed above?"
FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/fix_galagedara_aliases.ts --apply 2>&1 | grep -v "^prisma:query"
ok "Galagedara aliases resolved"

# ------------------------------------------------------------- billing rebuild
say "June 2026 rebuild — DRY RUN (nothing written)"
FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/deploy_june_rebuild.ts 2>&1 | grep -v "^prisma:query"
echo
confirm "Apply the June rebuild shown above?"
FUEL_DATABASE_URL="file:$LIVE_DB" npx tsx scripts/deploy_june_rebuild.ts --apply 2>&1 | grep -v "^prisma:query"

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
echo "    Rollback: pm2 stop $PM2_APP && cp \"$BACKUP\" \"$LIVE_DB\" && rm -f \"${LIVE_DB}-wal\" \"${LIVE_DB}-shm\" && pm2 start $PM2_APP"
echo
