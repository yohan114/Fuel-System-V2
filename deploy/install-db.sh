#!/usr/bin/env bash
# =============================================================================
#  Install a shipped database into /var/lib/fuel-system/app.db
#
#      sudo bash deploy/install-db.sh /tmp/app-ship.db
#
#  Refuses rather than guesses. It will not overwrite an existing live database
#  without taking a backup first, and it verifies the incoming file before it is
#  moved into place — not after, when the old one is already gone.
# =============================================================================
set -euo pipefail

SRC="${1:-}"
APP_USER="${APP_USER:-fuelapp}"
DATA_DIR="${DATA_DIR:-/var/lib/fuel-system}"
LIVE="${DATA_DIR}/app.db"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fuel-system}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -n "$SRC" ]] || die "usage: sudo bash deploy/install-db.sh /path/to/app-ship.db"
[[ -f "$SRC" ]] || die "no such file: $SRC"
command -v sqlite3 >/dev/null || die "sqlite3 is not installed — run deploy/bootstrap.sh first"

# ── verify the incoming file BEFORE touching anything ────────────────────────
say "Verifying the incoming file"
printf '    sha256 : %s\n' "$(sha256sum "$SRC" | cut -d' ' -f1)"
printf '    size   : %s\n' "$(du -h "$SRC" | cut -f1)"

integrity="$(sqlite3 "$SRC" 'PRAGMA integrity_check;' 2>&1 | head -1)"
[[ "$integrity" == "ok" ]] || die "integrity_check says: $integrity"
ok "integrity_check ok"

# A shipped file must be self-contained. A stray -wal beside it means the export
# was a plain copy, and the newest fuel issues are in that sidecar rather than
# in the file — it opens cleanly and silently lacks them.
for sidecar in "-wal" "-shm"; do
  [[ -e "${SRC}${sidecar}" ]] && die "${SRC}${sidecar} exists — this file is not self-contained. Re-run scripts/make-ship-db.ts."
done
ok "no -wal/-shm sidecars"

counts="$(sqlite3 "$SRC" "SELECT (SELECT COUNT(*) FROM User)||' users, '||(SELECT COUNT(*) FROM Asset)||' assets, '||(SELECT COUNT(*) FROM FuelIssue)||' fuelIssues, '||(SELECT COUNT(*) FROM Bill)||' bills';")"
printf '    counts : %s\n' "$counts"
[[ "$counts" == 0\ users* ]] && die "zero users — this is an empty database, not the live one"
ok "contents look like a real database"

# ── back up whatever is already there ────────────────────────────────────────
if [[ -f "$LIVE" ]]; then
  say "An existing live database is present — backing it up first"
  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="${BACKUP_DIR}/app.db.replaced-${stamp}"
  # .backup, not cp: it is safe against a concurrent writer and folds in the WAL.
  sqlite3 "$LIVE" ".backup '${dest}'"
  chown "$APP_USER:$APP_USER" "$dest"
  ok "existing database saved to ${dest}"
  old="$(sqlite3 "$LIVE" "SELECT (SELECT COUNT(*) FROM User)||' users, '||(SELECT COUNT(*) FROM FuelIssue)||' fuelIssues';" 2>/dev/null || echo 'unreadable')"
  printf '    it held : %s\n' "$old"
  warn "you are about to REPLACE the live database"
  read -r -p "$(printf '\033[1;33m    type REPLACE to continue: \033[0m')" reply
  [[ "$reply" == "REPLACE" ]] || die "cancelled — nothing was changed"
fi

# ── install ──────────────────────────────────────────────────────────────────
say "Installing"
mkdir -p "$DATA_DIR"
# Clear stale sidecars from any previous database, or SQLite will try to
# recover a WAL that belongs to a file that no longer exists.
rm -f "${LIVE}-wal" "${LIVE}-shm"
mv "$SRC" "$LIVE"
chown "$APP_USER:$APP_USER" "$LIVE"
chmod 640 "$LIVE"
# The directory must be writable by the app user: SQLite creates app.db-wal and
# app.db-shm beside the database, and cannot do so in a read-only directory.
chown "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
ok "installed at $LIVE (0640, $APP_USER)"

say "Verifying in place"
printf '    sha256 : %s\n' "$(sha256sum "$LIVE" | cut -d' ' -f1)"
printf '    counts : %s\n' "$(sudo -u "$APP_USER" sqlite3 "$LIVE" "SELECT (SELECT COUNT(*) FROM User)||' users, '||(SELECT COUNT(*) FROM Asset)||' assets, '||(SELECT COUNT(*) FROM FuelIssue)||' fuelIssues, '||(SELECT COUNT(*) FROM Bill)||' bills';")"

# Prove the app user can actually WRITE, which is what mixed ownership breaks.
if sudo -u "$APP_USER" sqlite3 "$LIVE" "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS _write_probe(x); DROP TABLE _write_probe;" >/dev/null 2>&1; then
  ok "$APP_USER can write (WAL mode confirmed)"
else
  die "$APP_USER cannot write to $LIVE — check ownership of BOTH the file and $DATA_DIR"
fi

echo
echo "Compare the sha256 and the four counts against what make-ship-db.ts printed."
echo "If they differ, stop and re-ship. Then: sudo bash deploy/start-app.sh"
