#!/usr/bin/env bash
# ==============================================================================
#  E&C Fuel System V2 — safe update for a LIVE server
#
#  Protects the running database. data/app.db is tracked in git, so a plain
#  pull would overwrite live operator data; this backs it up, takes only the
#  new code, then puts the live database back before migrating.
#
#  Usage:   cd /path/to/Fuel-System-V2
#           bash deploy-to-vps.sh
# ==============================================================================
set -euo pipefail

BRANCH="claude/wonderful-hypatia-yi703x"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${HOME}/fuel-db-backups"
BACKUP="${BACKUP_DIR}/app.db.live.${STAMP}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

confirm() {
  read -r -p "$(printf '\033[1;33m%s [y/N] \033[0m' "$1")" reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "Cancelled by user."
}

# ---------------------------------------------------------------- sanity check
say "Checking this is the app folder"
[[ -f package.json && -f prisma/schema.prisma ]] || die "Run this from the Fuel-System-V2 folder (package.json + prisma/schema.prisma not found here)."
[[ -d .git ]] || die "This folder is not a git repository."
ok "Folder looks right: $(pwd)"

command -v node >/dev/null || die "node is not installed"
command -v npm  >/dev/null || die "npm is not installed"
ok "node $(node -v), npm $(npm -v)"

# ------------------------------------------------------------------ back it up
say "Backing up the LIVE database (most important step)"
[[ -f data/app.db ]] || die "data/app.db not found — is this really the running app?"
mkdir -p "$BACKUP_DIR"
cp data/app.db "$BACKUP"
[[ -s "$BACKUP" ]] || die "Backup is empty — aborting before any changes."
LIVE_SUM="$(sha256sum data/app.db | cut -c1-16)"
ok "Backed up to $BACKUP  ($(du -h "$BACKUP" | cut -f1), sha ${LIVE_SUM})"

echo
echo "    Live data currently in the database:"
DATABASE_URL="file:./data/app.db" npx tsx -e '
import { prisma } from "./src/lib/db";
(async () => {
  const [f, u, b] = await Promise.all([
    prisma.fuelIssue.count(), prisma.user.count(), prisma.bill.count(),
  ]);
  console.log(`      fuel issues: ${f}   users: ${u}   bills: ${b}`);
  await prisma.$disconnect();
})();' 2>/dev/null | grep -v "^prisma:query" || warn "(could not read counts — continuing)"

# --------------------------------------------------------------- take new code
say "Fetching the updated code"
confirm "Replace the CODE with branch ${BRANCH}? (your database will be restored right after)"
git fetch origin "$BRANCH"
git checkout -f -B "$BRANCH" "origin/$BRANCH"
ok "Now at $(git log --oneline -1)"

# ------------------------------------------------------------ restore live data
say "Restoring YOUR live database over the repo's copy"
cp "$BACKUP" data/app.db
NOW_SUM="$(sha256sum data/app.db | cut -c1-16)"
[[ "$NOW_SUM" == "$LIVE_SUM" ]] || die "Restore mismatch (${NOW_SUM} != ${LIVE_SUM}) — restore manually from $BACKUP"
ok "Live database restored and verified (sha ${NOW_SUM})"

# -------------------------------------------------------- dependencies + schema
say "Installing dependencies"
npm ci
npx prisma generate
ok "Dependencies ready"

say "Applying database migrations (additive — no data is dropped)"
DATABASE_URL="file:./data/app.db" npx prisma migrate deploy
ok "Schema up to date"

# ------------------------------------------------------------- billing rebuild
say "June 2026 rebuild — DRY RUN first (nothing is written)"
npx tsx scripts/deploy_june_rebuild.ts 2>&1 | grep -v "^prisma:query"

echo
confirm "Apply the June rebuild shown above to the live database?"
say "Applying June rebuild"
npx tsx scripts/deploy_june_rebuild.ts --apply 2>&1 | grep -v "^prisma:query"

# --------------------------------------------------------------- build + restart
say "Building the app"
npm run build
ok "Build complete"

say "Restarting the service"
if command -v pm2 >/dev/null && pm2 list 2>/dev/null | grep -qiE "fuel|next|app"; then
  pm2 restart all --update-env && pm2 save
  ok "Restarted via pm2"
elif systemctl list-units --type=service 2>/dev/null | grep -qiE "fuel|next"; then
  SVC="$(systemctl list-units --type=service --no-legend | grep -iE 'fuel|next' | awk '{print $1}' | head -1)"
  sudo systemctl restart "$SVC"
  ok "Restarted $SVC"
else
  warn "No pm2/systemd service detected — restart the app yourself."
fi

say "DONE"
echo "    Database backup kept at: $BACKUP"
echo "    To roll back:  cp \"$BACKUP\" data/app.db  && restart the app"
echo
