#!/usr/bin/env bash
# =============================================================================
#  Replace the live fuel database with one prepared elsewhere.
#
#      sudo bash deploy/restore-db.sh /tmp/app-new.db
#      sudo bash deploy/restore-db.sh /tmp/app-new.db.gz
#      FORCE=1 sudo bash deploy/restore-db.sh /tmp/app-new.db   # skip the loss check
#
#  This is the dangerous direction. Everything typed into the live system since
#  the incoming file was prepared is destroyed, silently — the row counts still
#  look plausible afterwards and the app still starts. Twenty hand-entered fuel
#  issues went that way on this project already. So this script refuses more
#  than it accepts.
#
#  IT WILL NOT RUN WHILE THE APP IS UP. SQLite in WAL mode keeps the newest
#  writes in app.db-wal, not app.db. Copy a different database over app.db while
#  a process still holds the old WAL and SQLite applies that WAL to a file it
#  does not belong to — which corrupts it. That is not theoretical: it happened
#  to the local copy of this database an hour before this script was written.
#  Hence the refusal, and hence removing -wal and -shm rather than leaving them.
#
#  IT COUNTS WHAT YOU WOULD LOSE BEFORE IT WRITES. If the live database holds
#  fuel issues newer than the newest in the incoming file, it stops and tells
#  you how many and how new. Override only when you know where those rows went.
# =============================================================================
set -euo pipefail

INCOMING="${1:-}"
LIVE="${LIVE:-/var/lib/fuel-system/app.db}"
APP_USER="${APP_USER:-fuelapp}"
KEEP_DIR="${KEEP_DIR:-/var/backups/fuel-system}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mREFUSED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -n "$INCOMING" ]] || die "usage: sudo bash deploy/restore-db.sh <new-database.db[.gz]>"
[[ -f "$INCOMING" ]] || die "no such file: $INCOMING"
command -v sqlite3 >/dev/null || die "sqlite3 is not installed"
[[ -f "$LIVE" ]] || die "no live database at $LIVE — this script replaces, it does not install"

# ---------------------------------------------------------------- unpack
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
NEW="$work/incoming.db"
case "$INCOMING" in
  *.gz) say "Decompressing"; gunzip -c "$INCOMING" > "$NEW" ;;
  *)    cp "$INCOMING" "$NEW" ;;
esac
printf '    %s\n' "$(du -h "$NEW" | cut -f1)"

# ------------------------------------------------- is anything holding the db?
say "Checking nothing is using the live database"
holders=""
if command -v fuser >/dev/null 2>&1; then
  holders="$(fuser "$LIVE" 2>/dev/null || true)"
elif command -v lsof >/dev/null 2>&1; then
  holders="$(lsof -t "$LIVE" 2>/dev/null || true)"
else
  warn "neither fuser nor lsof present — cannot check. Make certain the app is stopped."
fi
if [[ -n "${holders// /}" ]]; then
  echo >&2
  echo "  processes still holding $LIVE:" >&2
  for p in $holders; do ps -o pid=,user=,cmd= -p "$p" 2>/dev/null | sed 's/^/    /' >&2 || true; done
  die "stop the app first. Replacing the file underneath a running process corrupts it."
fi
ok "nothing is holding it"

# --------------------------------------------------- is the incoming file sane?
say "Checking the incoming database"
chk="$(sqlite3 "$NEW" 'PRAGMA integrity_check;' 2>/dev/null | head -1 || echo failed)"
printf '    integrity_check : %s\n' "$chk"
[[ "$chk" == "ok" ]] || die "the incoming file is not a healthy database"

q_users='SELECT COUNT(*) FROM User'
q_issues='SELECT COUNT(*) FROM FuelIssue WHERE voided=0'
q_latest='SELECT COALESCE(MAX(issueDate),"") FROM FuelIssue WHERE voided=0'

new_users="$(sqlite3 "$NEW" "$q_users" 2>/dev/null || echo 0)"
[[ "$new_users" -gt 0 ]] || die "the incoming database has zero users — that is an empty database, not a live one"
new_issues="$(sqlite3 "$NEW" "$q_issues")"
new_latest="$(sqlite3 "$NEW" "$q_latest")"
live_users="$(sqlite3 "$LIVE" "$q_users")"
live_issues="$(sqlite3 "$LIVE" "$q_issues")"
live_latest="$(sqlite3 "$LIVE" "$q_latest")"

printf '    incoming : %s users, %s live issues, newest %s\n' "$new_users" "$new_issues" "${new_latest:0:10}"
printf '    live     : %s users, %s live issues, newest %s\n' "$live_users" "$live_issues" "${live_latest:0:10}"

# ------------------------------------------------ what would the swap destroy?
say "What the swap would destroy"
# Rows on the LIVE database newer than anything in the incoming file cannot
# possibly be represented in it, whatever their ids. That is the cheap, certain
# test; a full row-by-row diff belongs to scripts/compare-before-overwrite.cjs
# on a machine that has both files.
lost="$(sqlite3 "$LIVE" "SELECT COUNT(*) FROM FuelIssue WHERE voided=0 AND issueDate > '${new_latest}'")"
typed="$(sqlite3 "$LIVE" "SELECT COUNT(*) FROM FuelIssue WHERE voided=0 AND issueDate > '${new_latest}' AND importKey IS NULL")"
if [[ "$lost" -gt 0 ]]; then
  printf '\033[1;31m    %s live fuel issue(s) are newer than anything in the incoming file\033[0m\n' "$lost"
  printf '\033[1;31m    %s of them were typed in by hand and exist nowhere else\033[0m\n' "$typed"
  echo
  sqlite3 -header -column "$LIVE" "
    SELECT date(f.issueDate,'+5 hours','+30 minutes') day, a.code machine,
           f.litres, COALESCE(f.source,'') source
    FROM FuelIssue f JOIN Asset a ON a.id=f.assetId
    WHERE f.voided=0 AND f.issueDate > '${new_latest}'
    ORDER BY f.issueDate LIMIT 30" | sed 's/^/    /'
  echo
  [[ "${FORCE:-0}" == "1" ]] || die "re-pull, re-apply your changes on top, and ship that instead. FORCE=1 overrides."
  warn "FORCE=1 set — proceeding, and these rows are being destroyed"
else
  ok "nothing on the live database is newer than the incoming file"
fi

# -------------------------------------------------------- keep the old one
say "Keeping the database being replaced"
mkdir -p "$KEEP_DIR"
kept="${KEEP_DIR}/fuel-replaced-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$LIVE" ".backup '${kept}'"
kept_issues="$(sqlite3 "$kept" "$q_issues")"
[[ "$kept_issues" == "$live_issues" ]] || die "the safety copy does not match the live database — stopping before any change"
gzip -9 "$kept"
ok "$(basename "${kept}.gz") — this is your way back"

# ----------------------------------------------------------------- swap
say "Swapping"
# -wal and -shm belong to the database being removed. Left in place they would
# be applied to the incoming file, which is exactly how a good database becomes
# a corrupt one.
rm -f "${LIVE}-wal" "${LIVE}-shm"
install -o "$APP_USER" -g "$APP_USER" -m 0640 "$NEW" "$LIVE"
ok "in place"

say "Confirming what is now live"
printf '    integrity_check : %s\n' "$(sqlite3 "$LIVE" 'PRAGMA integrity_check;' | head -1)"
printf '    %s users, %s live issues, newest %s\n' \
  "$(sqlite3 "$LIVE" "$q_users")" "$(sqlite3 "$LIVE" "$q_issues")" "$(sqlite3 "$LIVE" "$q_latest" | cut -c1-10)"
sqlite3 -header -column "$LIVE" "
  SELECT p.code site, COUNT(*) issues, ROUND(SUM(f.litres),1) litres
  FROM FuelIssue f
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE f.voided=0 AND f.issueDate >= '2026-07-31T18:30:00.000+00:00'
                  AND f.issueDate <  '2026-08-31T18:30:00.000+00:00'
    AND p.code IN ('CEP-03F','BATTI-02')
  GROUP BY p.code" | sed 's/^/    /'

echo
echo "  Start the app again, then regenerate the August drafts for CEP-03F and BATTI-02."
echo "  If anything looks wrong: gunzip ${kept}.gz and restore it the same way."
echo
