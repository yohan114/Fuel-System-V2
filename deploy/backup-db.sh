#!/usr/bin/env bash
# =============================================================================
#  Verified backup of the live fuel database.
#
#      sudo bash deploy/backup-db.sh
#      KEEP=30 sudo bash deploy/backup-db.sh      # retention, default 14 days
#
#  Safe to run while the app is serving, and safe to run from cron.
#
#  IT USES sqlite3 .backup, NOT cp. SQLite runs in WAL mode, so the newest
#  writes live in app.db-wal rather than app.db. A plain copy takes the main
#  file only, loses whatever was in the WAL, and gives no sign of it — the copy
#  opens cleanly and integrity_check says ok. `.backup` is safe against a
#  concurrent writer and folds the WAL in.
#
#  IT VERIFIES BEFORE IT KEEPS. A backup nobody has checked is a hope, not a
#  backup. This one refuses to keep a copy whose row counts differ from the
#  source, and refuses a source that fails integrity_check — because the worst
#  outcome available is overwriting good data with a corrupt "backup" later.
#
#  The 22 August archives this system was relying on turned out to hold a
#  database two months stale: the job had snapshotted a leftover data/app.db
#  from a `next build` instead of the live one, and reported success every time.
#  Hence the count check, and hence printing what was captured.
# =============================================================================
set -euo pipefail

LIVE="${LIVE:-/var/lib/fuel-system/app.db}"
DEST="${DEST:-/var/backups/fuel-system}"
APP_USER="${APP_USER:-fuelapp}"
KEEP="${KEEP:-14}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 is not installed"
[[ -f "$LIVE" ]] || die "no database at $LIVE"
mkdir -p "$DEST"

stamp="$(date +%Y%m%d-%H%M%S)"
out="${DEST}/fuel-${stamp}.db"

say "Integrity of the source"
chk="$(sqlite3 "$LIVE" 'PRAGMA integrity_check;' | head -1)"
printf '    %s\n' "$chk"
[[ "$chk" == "ok" ]] || die "the LIVE database is corrupt — do not overwrite anything with it, and stop the app before investigating"

say "Snapshot"
sqlite3 "$LIVE" ".backup '${out}'"
ok "written to $out"

say "Verifying the copy against the source"
q="SELECT (SELECT COUNT(*) FROM User)||' users, '\
||(SELECT COUNT(*) FROM Asset)||' assets, '\
||(SELECT COUNT(*) FROM FuelIssue WHERE voided=0)||' issues, '\
||(SELECT COUNT(*) FROM Bill)||' bills'"
src="$(sqlite3 "$LIVE" "$q")"
cpy="$(sqlite3 "$out" "$q")"
printf '    source : %s\n' "$src"
printf '    copy   : %s\n' "$cpy"
if [[ "$src" != "$cpy" ]]; then rm -f "$out"; die "the copy does not match the source — discarded"; fi
case "$cpy" in
  0\ users*) rm -f "$out"; die "zero users — that is an empty database, not the live one" ;;
esac
ok "counts match"

say "Compressing"
gzip -9 "$out"
sha256sum "${out}.gz" > "${out}.gz.sha256"
printf '    %s\n' "$(cut -d' ' -f1 < "${out}.gz.sha256")"
printf '    size   : %s\n' "$(du -h "${out}.gz" | cut -f1)"

say "Pruning backups older than ${KEEP} days"
found=0
while IFS= read -r f; do printf '    removed %s\n' "$f"; found=1; done < <(
  find "$DEST" -name 'fuel-*.db.gz*' -mtime "+${KEEP}" -print -delete 2>/dev/null || true
)
[[ $found -eq 1 ]] || ok "nothing old enough to remove"

chown -R "$APP_USER:$APP_USER" "$DEST" 2>/dev/null || true

echo
echo "  ${out}.gz"
echo
echo "  A copy on the same disk as the database is not a backup. Pull it down:"
echo "     scp <you>@<host>:${out}.gz ."
