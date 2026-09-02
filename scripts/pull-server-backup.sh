#!/usr/bin/env bash
# =============================================================================
#  Pull the newest verified backup off the VPS onto this machine.
#
#      bash scripts/pull-server-backup.sh
#      HOST=you@1.2.3.4 KEEP=20 bash scripts/pull-server-backup.sh
#
#  Runs from Git Bash on Windows. It takes a backup that the SERVER has already
#  verified (deploy/backup-db.sh) and checks it again on arrival, because the
#  two things that go wrong are different at each end: the server can snapshot
#  the wrong file, and the transfer can truncate.
#
#  It does NOT run the backup on the server — do that first, or schedule it
#  there. This only fetches.
#
#  UNATTENDED USE: scp will ask for your key passphrase unless an ssh-agent is
#  running. Start one in the same shell first:
#      eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519
#  Task Scheduler has no agent, so a scheduled pull needs either a passphrase-
#  less key kept for this purpose alone, or a Windows credential helper.
# =============================================================================
set -euo pipefail

HOST="${HOST:-yohanudara@20.204.51.43}"
REMOTE_DIR="${REMOTE_DIR:-/var/backups/fuel-system}"
LOCAL_DIR="${LOCAL_DIR:-D:/Fuel system server side/backups}"
KEEP="${KEEP:-20}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ok   %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    !    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

# node resolves modules against the CALLER's cwd, and Git Bash starts at / —
# where better-sqlite3 does not exist. Anchor to the repo holding this script.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$LOCAL_DIR"

say "Finding the newest backup on $HOST"
# Ask for the listing AND a marker in one connection. `ls | head` exits 0 even
# when ls found nothing, so without the marker an unreachable host and an empty
# directory look identical — and the message then sends you to the wrong place.
probe="$(ssh "$HOST" "
  echo REACHED
  printf 'NEWEST:%s\n' \"\$(ls -1t ${REMOTE_DIR}/fuel-*.db.gz 2>/dev/null | head -1)\"
  echo ---
  ls -1 ${REMOTE_DIR} 2>/dev/null | head -5
")" || die "could not reach $HOST. Check it is up and that 'ssh $HOST' works by hand."
[[ "$probe" == REACHED* ]] || die "connected to $HOST but the command did not run"

# NEWEST: is printed unconditionally, so it is empty rather than absent when
# there are no backups. `ls | head` prints NOTHING when it matches nothing — not
# a blank line — so reading a fixed line number picked up the --- separator and
# handed it to basename.
newest="$(sed -n 's/^NEWEST://p' <<<"$probe")"
if [[ -z "$newest" ]]; then
  echo >&2
  echo "FAILED: connected fine, but ${REMOTE_DIR} holds no fuel-*.db.gz" >&2
  others="$(sed -n '/^---$/,$p' <<<"$probe" | tail -n +2)"
  if [[ -n "$others" ]]; then
    echo "  what IS in that directory:" >&2
    sed 's/^/    /' <<<"$others" >&2
  else
    echo "  that directory is empty or missing." >&2
  fi
  echo >&2
  echo "  A backup has to be MADE on the server before it can be pulled. There:" >&2
  echo "     sudo bash /var/www/fuelsystem/deploy/backup-db.sh" >&2
  exit 1
fi
base="$(basename "$newest")"
printf '    %s\n' "$base"

if [[ -f "${LOCAL_DIR}/${base}" ]]; then
  ok "already here — nothing to fetch"
  exit 0
fi

say "Fetching"
# ONE scp for both files. As two calls, each prompts separately under password
# auth and the second was quietly skipped — which is why the hash check kept
# downgrading itself to "size only" even though the server had written a .sha256.
if ! scp -q "${HOST}:${newest}" "${HOST}:${newest}.sha256" "${LOCAL_DIR}/" 2>/dev/null; then
  scp -q "${HOST}:${newest}" "${LOCAL_DIR}/${base}"
fi
[[ -f "${LOCAL_DIR}/${base}" ]] || die "the transfer produced no file"

say "Checking it arrived intact"
if [[ -f "${LOCAL_DIR}/${base}.sha256" ]]; then
  want="$(cut -d' ' -f1 < "${LOCAL_DIR}/${base}.sha256")"
  got="$(sha256sum "${LOCAL_DIR}/${base}" | cut -d' ' -f1)"
  printf '    server : %s\n    local  : %s\n' "$want" "$got"
  [[ "$want" == "$got" ]] || { rm -f "${LOCAL_DIR}/${base}" "${LOCAL_DIR}/${base}.sha256"; die "hash mismatch — the transfer was corrupted, discarded"; }
  ok "hash matches"
else
  # The server writes a .sha256 beside each backup; an older one may not have.
  printf '\033[1;33m    !    no .sha256 on the server for this file — size checked only\033[0m\n'
  [[ "$(stat -c%s "${LOCAL_DIR}/${base}")" -gt 1000000 ]] || die "file is implausibly small — discarded"
fi

say "Opening it, to prove it is a database and not just bytes"
gunzip -c "${LOCAL_DIR}/${base}" > "${LOCAL_DIR}/.verify.db"

set +e
( cd "$REPO" && node "${REPO}/scripts/verify-backup.cjs" "${LOCAL_DIR}/.verify.db" ) \
  > "${LOCAL_DIR}/.verify.out" 2>&1
rc=$?
set -e
cat "${LOCAL_DIR}/.verify.out"
rm -f "${LOCAL_DIR}/.verify.db"

if [[ $rc -eq 0 ]]; then
  rm -f "${LOCAL_DIR}/.verify.out"
  ok "restores and reads correctly"
elif grep -q "Cannot find module" "${LOCAL_DIR}/.verify.out"; then
  # A file that FAILS the check is bad and goes. A check that could not RUN says
  # nothing about the file. Deleting a good backup because a module was missing
  # is the worst outcome available here, and it happened once before this guard
  # existed.
  rm -f "${LOCAL_DIR}/.verify.out"
  warn "could not run the check — file KEPT, unverified"
  echo "         run 'npm install' in ${REPO}, then re-run this script"
else
  rm -f "${LOCAL_DIR}/.verify.out" "${LOCAL_DIR}/${base}"
  die "the file is not a usable database — discarded"
fi

say "Keeping the newest ${KEEP}"
ls -1t "${LOCAL_DIR}"/fuel-*.db.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while IFS= read -r old; do
  rm -f "$old" "${old}.sha256"; printf '    removed %s\n' "$(basename "$old")"
done

echo
echo "  ${LOCAL_DIR}/${base}"
