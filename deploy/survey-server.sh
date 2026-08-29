#!/usr/bin/env bash
# =============================================================================
#  E&C Fuel System — PRE-DEPLOYMENT SERVER SURVEY  (READ ONLY)
#
#      curl -fsSL .../deploy/survey-server.sh -o survey-server.sh
#      less survey-server.sh          # read it before you run it
#      sudo bash survey-server.sh 2>&1 | tee /tmp/fuel-survey.txt
#
#  PURPOSE
#      The deploy/ bundle was written for a fresh, empty Ubuntu box. This VPS
#      already runs WorkshopOne. This script answers one question and changes
#      nothing: "what is already here, and what will the fuel deployment
#      collide with?"
#
#  WHAT IT DOES NOT DO — by design, so it is safe on production at any time:
#      * no apt / apt-get / dpkg install, no package changes
#      * no systemctl start|stop|restart|reload|enable|disable
#      * no writes anywhere except one report file under /tmp
#      * no `nginx -s reload` (only `nginx -T`, which parses and prints)
#      * NEVER opens any SQLite database. Running `sqlite3 file.db .tables` on
#        a WAL database creates the -shm file and can checkpoint the WAL on
#        close — that is a WRITE to WorkshopOne's live data. We only stat().
#      * never prints a secret. Other apps' .env files and /proc/*/environ are
#        reported as KEY NAMES ONLY, never values.
#
#  Run it with sudo. Without root you still get most of it, but you cannot see
#  process owners on listening sockets, other users' crontabs, /proc/*/environ,
#  or root-owned config — and those are exactly the collisions that matter.
# =============================================================================

# Deliberately NO `set -e` and NO `set -u`. A survey must keep going when a
# tool is missing; aborting halfway is worse than a gap in the report.

REPORT="/tmp/fuel-survey-$(date +%Y%m%d-%H%M%S).txt"

# ── formatting helpers ───────────────────────────────────────────────────────
sec()  { printf '\n\n=======================================================================\n %s\n=======================================================================\n' "$*"; }
sub()  { printf '\n--- %s ---\n' "$*"; }
note() { printf '    %s\n' "$*"; }
miss() { printf '    [skipped: %s]\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Run with a timeout when `timeout` exists; otherwise run bare.
tmo() { local t="$1"; shift; if have timeout; then timeout "$t" "$@"; else "$@"; fi; }

# Indent whatever a command prints, and say so when it prints nothing.
run() {
  local out
  out="$("$@" 2>&1)"
  if [ -z "$out" ]; then note "(no output)"; else printf '%s\n' "$out" | sed 's/^/    /'; fi
}

# Run a pipeline given as a string, indent it, and print a fallback when it
# yields nothing. Needed because in `cmd | grep | sed` the exit status is
# sed's — always 0 — so a trailing `|| fallback` would never fire even when
# grep matched nothing.
show() {
  local fallback="$1"; shift
  local out
  out="$(sh -c "$*" 2>/dev/null)"
  if [ -n "$out" ]; then printf '%s\n' "$out" | sed 's/^/      /'
  else printf '      %s\n' "$fallback"; fi
}

# Print ONLY the variable names from an env-style file. Values never leave.
env_keys() {
  local f="$1"
  [ -r "$f" ] || { miss "not readable: $f"; return; }
  note "$f  (owner $(stat -c '%U:%G' "$f" 2>/dev/null || echo '?'), mode $(stat -c '%a' "$f" 2>/dev/null || echo '?'))"
  note "keys only:"
  sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=.*/      \2/p' "$f" 2>/dev/null | sort -u
}

# stat a file plus its parent directory plus any SQLite sidecars. Never opens it.
db_report() {
  local f="$1" d
  d="$(dirname "$f")"
  if have stat; then
    stat -c '    FILE %n  owner=%U:%G  mode=%a  size=%s  mtime=%y' "$f" 2>/dev/null
    stat -c '    DIR  %n  owner=%U:%G  mode=%a' "$d" 2>/dev/null
  else
    ls -ld "$f" "$d" 2>/dev/null | sed 's/^/    /'
  fi
  local found=0 s
  for s in -wal -shm -journal; do
    if [ -e "${f}${s}" ]; then
      found=1
      stat -c '    SIDECAR %n  owner=%U:%G  mode=%a  size=%s  mtime=%y' "${f}${s}" 2>/dev/null \
        || ls -l "${f}${s}" 2>/dev/null | sed 's/^/    /'
    fi
  done
  [ "$found" -eq 0 ] && note "no -wal / -shm / -journal sidecar present right now"
  have file && note "type: $(file -b "$f" 2>/dev/null)"
}

# Who is listening on a TCP port?
port_owner() {
  local p="$1" out=""
  if have ss;      then out="$(ss -tlnp "sport = :$p" 2>/dev/null | tail -n +2)"; fi
  if [ -z "$out" ] && have netstat; then out="$(netstat -tlnp 2>/dev/null | grep -E "[:.]$p[[:space:]]")"; fi
  if [ -z "$out" ] && have lsof;    then out="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | tail -n +2)"; fi
  printf '%s' "$out"
}

# PID of whatever listens on a TCP port.
pid_on_port() {
  local p="$1" pid=""
  if have ss;   then pid="$(ss -tlnp "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"; fi
  if [ -z "$pid" ] && have lsof;  then pid="$(lsof -tnP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | head -1)"; fi
  if [ -z "$pid" ] && have fuser; then pid="$(fuser "$p/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -1)"; fi
  printf '%s' "$pid"
}

# ── preamble ─────────────────────────────────────────────────────────────────
exec > >(tee "$REPORT") 2>&1

printf '#######################################################################\n'
printf '#  FUEL SYSTEM PRE-DEPLOYMENT SURVEY — READ ONLY, CHANGES NOTHING\n'
printf '#  host   : %s\n' "$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo unknown)"
printf '#  date   : %s\n' "$(date -Is 2>/dev/null || date)"
printf '#  run by : %s (uid %s)\n' "$(id -un 2>/dev/null)" "$(id -u 2>/dev/null)"
printf '#  report : %s\n' "$REPORT"
printf '#######################################################################\n'

if [ "$(id -u 2>/dev/null)" != "0" ]; then
  printf '\n*** NOT RUNNING AS ROOT ***\n'
  printf '    Process owners, other users crontabs, /proc/*/environ and root-owned\n'
  printf '    config will be missing. Re-run with: sudo bash %s\n' "$0"
fi

# =============================================================================
sec "1. OPERATING SYSTEM"
# =============================================================================
sub "distribution"
if [ -r /etc/os-release ]; then
  grep -E '^(PRETTY_NAME|VERSION_ID|VERSION_CODENAME|ID)=' /etc/os-release | sed 's/^/    /'
else
  miss "/etc/os-release not readable"
fi
have lsb_release && run lsb_release -a

sub "kernel / architecture"
run uname -a
note "arch      : $(uname -m 2>/dev/null)"
note "dpkg arch : $(dpkg --print-architecture 2>/dev/null || echo 'dpkg not available')"
if [ -r /sys/hypervisor/uuid ] || have systemd-detect-virt; then
  note "virt      : $(systemd-detect-virt 2>/dev/null || echo unknown)"
fi

sub "uptime / load"
run uptime
have who && run who -b

sub "time and timezone"
# The fuel bootstrap runs `timedatectl set-timezone Asia/Colombo`, which is
# system-wide. Whatever is here now is what WorkshopOne is currently using.
if have timedatectl; then
  run timedatectl
else
  note "date  : $(date)"
  note "TZ    : $(cat /etc/timezone 2>/dev/null || readlink -f /etc/localtime 2>/dev/null || echo unknown)"
fi
note "CURRENT SYSTEM TIMEZONE = $( { timedatectl show -p Timezone --value 2>/dev/null; } || cat /etc/timezone 2>/dev/null || echo unknown)"
note "^ bootstrap.sh will CHANGE this to Asia/Colombo for every app on the box."

# =============================================================================
sec "2. MEMORY, SWAP, DISK"
# =============================================================================
sub "memory and swap"
have free && run free -h || { [ -r /proc/meminfo ] && grep -E 'MemTotal|MemAvailable|SwapTotal|SwapFree' /proc/meminfo | sed 's/^/    /'; }
run swapon --show
note "^ 'npm run build' for Next.js 16 typically needs 2-4 GB. If MemAvailable"
note "  is small and there is no swap, the build can OOM-kill WorkshopOne."

sub "disk free"
have df && run df -h / /var /var/lib /var/www /opt /home /tmp
sub "largest consumers under /var (top 10)"
have du && run sh -c 'du -xhd1 /var 2>/dev/null | sort -rh | head -11'

sub "inodes"
have df && run df -ih / /var

# =============================================================================
sec "3. NODE.JS — WHICH VERSIONS, WHERE, AND WHOSE"
# =============================================================================
# bootstrap.sh replaces the SYSTEM node with NodeSource Node 24 whenever
# `node -v` is not already v24.x. If WorkshopOne runs on the system node, that
# upgrade changes NODE_MODULE_VERSION under it and every native module it has
# compiled (its own better-sqlite3) stops loading.
sub "what does 'node' resolve to right now"
if have node; then
  note "node -v          : $(node -v 2>&1)"
  note "which node       : $(command -v node)"
  note "resolved path    : $(readlink -f "$(command -v node)" 2>/dev/null)"
  note "NODE_MODULE_VER  : $(node -p 'process.versions.modules' 2>/dev/null)"
else
  note "node is NOT on PATH for $(id -un)"
fi
if have npm;  then note "npm -v  : $(npm -v 2>&1)";  else note "npm not on PATH";  fi
if have npx;  then note "npx     : $(command -v npx)"; fi

sub "every node binary on disk"
run sh -c 'ls -l /usr/bin/node /usr/local/bin/node /usr/bin/nodejs /opt/*/bin/node 2>/dev/null'
tmo 60 find /usr /opt /snap /home /root -maxdepth 6 -type f -name node -perm -u+x 2>/dev/null \
  | head -40 | while read -r n; do note "$n  ->  $("$n" -v 2>/dev/null || echo '?')"; done

sub "packaged node"
have dpkg && run sh -c 'dpkg -l | grep -iE "^ii\s+(nodejs|npm|libnode)" || echo "no nodejs deb installed"'
have apt-cache && run apt-cache policy nodejs
sub "nodesource / other apt repos for node"
run sh -c 'grep -rilE "nodesource|deb.nodesource" /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null || echo "no nodesource apt repo configured"'

sub "nvm / fnm / volta / asdf for any user"
for h in /root /home/*; do
  [ -d "$h" ] || continue
  u="$(basename "$h")"
  for mgr in .nvm .fnm .volta .asdf; do
    if [ -d "$h/$mgr" ]; then
      note "$u : $mgr present at $h/$mgr"
      [ -d "$h/$mgr/versions/node" ] && ls -1 "$h/$mgr/versions/node" 2>/dev/null | sed 's/^/        /'
      [ -d "$h/$mgr/node-versions" ] && ls -1 "$h/$mgr/node-versions" 2>/dev/null | sed 's/^/        /'
    fi
  done
  grep -lsE 'nvm.sh|fnm env|volta' "$h/.bashrc" "$h/.profile" "$h/.zshrc" 2>/dev/null | sed 's/^/    shell init references a version manager: /'
done

# =============================================================================
sec "4. LISTENING TCP PORTS — WHO OWNS WHAT"
# =============================================================================
sub "all listening TCP sockets"
if have ss; then
  run ss -tlnp
elif have netstat; then
  run netstat -tlnp
elif have lsof; then
  run lsof -nP -iTCP -sTCP:LISTEN
else
  miss "none of ss / netstat / lsof available"
fi

sub "listening UDP (context only)"
have ss && run ss -ulnp

sub "ports the fuel deployment cares about"
for p in 22 80 443 1929 3300 3000 8080; do
  o="$(port_owner "$p")"
  if [ -z "$o" ]; then
    printf '    :%-5s FREE\n' "$p"
  else
    printf '    :%-5s IN USE\n' "$p"
    printf '%s\n' "$o" | sed 's/^/          /'
  fi
done
note ""
note "3300 must be FREE — the fuel app binds it."
note "1929 should be WorkshopOne. 80/443 decide whether nginx can even start."

sub "sshd listening port (matters before anyone enables ufw)"
run sh -c 'grep -iE "^[[:space:]]*Port|^[[:space:]]*ListenAddress" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null || echo "no explicit Port directive (default 22)"'

# =============================================================================
sec "5. PM2"
# =============================================================================
sub "pm2 binaries"
if have pm2; then
  note "pm2 on PATH : $(command -v pm2)  version $(pm2 -v 2>&1 | tail -1)"
else
  note "pm2 not on PATH for $(id -un)"
fi
run sh -c 'ls -l /usr/lib/node_modules/pm2/bin/pm2 /usr/local/lib/node_modules/pm2/bin/pm2 2>/dev/null'
tmo 40 find /root /home -maxdepth 6 -type d -name pm2 -path '*node_modules*' 2>/dev/null | head -10 | sed 's/^/    /'

sub "running pm2 daemons (God processes) and their owners"
run sh -c "ps -eo user,pid,etime,rss,args | grep -i '[P]M2.*God\\|[p]m2: ' || echo 'no pm2 daemon process found'"

sub "PM2_HOME directories and saved process lists"
for h in /root /home/*; do
  [ -d "$h/.pm2" ] || continue
  u="$(basename "$h")"
  note "PM2_HOME = $h/.pm2   (owner $(stat -c '%U' "$h/.pm2" 2>/dev/null))"
  if [ -r "$h/.pm2/dump.pm2" ]; then
    note "  saved apps in dump.pm2:"
    if have jq; then
      jq -r '.[] | "      " + .name + "   script=" + (.pm_exec_path//"?") + "   cwd=" + (.pm_cwd//"?")' "$h/.pm2/dump.pm2" 2>/dev/null \
        || grep -oE '"name":"[^"]+"' "$h/.pm2/dump.pm2" 2>/dev/null | sed 's/^/      /'
    else
      grep -oE '"name":"[^"]+"' "$h/.pm2/dump.pm2" 2>/dev/null | sed 's/^/      /'
    fi
  else
    note "  no dump.pm2 (nothing saved for boot resurrect)"
  fi
  [ -d "$h/.pm2/logs" ] && note "  logs: $(ls -1 "$h/.pm2/logs" 2>/dev/null | wc -l) files, $(du -sh "$h/.pm2/logs" 2>/dev/null | cut -f1)"
done

sub "pm2 list for each user that has a PM2_HOME"
for h in /root /home/*; do
  [ -d "$h/.pm2" ] || continue
  u="$(basename "$h")"
  note "----- pm2 list as $u -----"
  if [ "$(id -u)" = "0" ]; then
    # `pm2 list` only reads the daemon's state. Give it an explicit PATH and
    # PM2_HOME because `su -s /bin/sh -c` starts a non-login shell with a
    # minimal environment and would otherwise not find the binary.
    show "pm2 not runnable as $u (binary not on PATH, or no daemon)" \
         "su -s /bin/sh -c 'PATH=/usr/local/bin:/usr/bin:/bin:\$HOME/.nvm/versions/node/*/bin PM2_HOME=$h/.pm2 pm2 list --no-color' $u"
  else
    miss "need root to inspect $u"
  fi
done

sub "pm2 systemd units"
run sh -c 'ls -l /etc/systemd/system/pm2-*.service /etc/systemd/system/multi-user.target.wants/pm2-*.service 2>/dev/null || echo "no pm2-*.service unit files"'
have systemctl && run sh -c 'systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | grep -i pm2 || echo "no pm2 systemd units loaded"'

# =============================================================================
sec "6. SYSTEMD — NON-STOCK UNITS THAT LOOK LIKE APPLICATIONS"
# =============================================================================
if have systemctl; then
  sub "unit files administrators added under /etc/systemd/system"
  run sh -c 'ls -l /etc/systemd/system/*.service /etc/systemd/system/*.timer 2>/dev/null || echo "none"'

  sub "running services minus the usual Ubuntu furniture"
  show "nothing unusual is running (or the filter hid it — see the full list with: systemctl list-units --type=service --state=running)" \
       "systemctl list-units --type=service --state=running --no-pager --no-legend | grep -vaiE '^(systemd-|dbus|cron|ssh|rsyslog|polkit|udisks|snapd|snap\\.|accounts-daemon|unattended|multipathd|irqbalance|getty|user@|packagekit|ModemManager|chrony|atd|apparmor|cloud-init|cloud-config|cloud-final|walinuxagent|serial-getty|networkd|resolved|logind|journald|udev|blk-availability|lvm2|open-vm-tools|qemu-guest-agent|waagent)'"

  sub "enabled units that are not part of the base image"
  show "none beyond the base image" \
       "systemctl list-unit-files --state=enabled --no-pager --no-legend | grep -vaiE '^(systemd-|dbus|cron|ssh|rsyslog|apparmor|snapd|unattended|multipathd|getty|remote-fs|e2scrub|networkd|resolved|open-vm|qemu|walinuxagent|waagent|cloud-|ufw|man-db|apt-daily|fstrim|logrotate|motd)'"
else
  miss "systemctl not available"
fi

# =============================================================================
sec "7. NGINX AND OTHER WEB SERVERS"
# =============================================================================
sub "is anything else already on 80/443"
for svc in apache2 httpd caddy haproxy traefik lighttpd; do
  if have systemctl && systemctl list-unit-files --no-pager --no-legend 2>/dev/null | grep -q "^${svc}\."; then
    note "$svc unit exists — active=$(systemctl is-active "$svc" 2>/dev/null) enabled=$(systemctl is-enabled "$svc" 2>/dev/null)"
  fi
  have "$svc" && note "$svc binary present at $(command -v "$svc")"
done

sub "nginx present?"
if have nginx; then
  run sh -c 'nginx -v 2>&1'
  note "active  : $(systemctl is-active nginx 2>/dev/null || echo unknown)"
  note "enabled : $(systemctl is-enabled nginx 2>/dev/null || echo unknown)"
  note "config test (read-only):"
  run sh -c 'nginx -t 2>&1'
else
  note "nginx is NOT installed. bootstrap.sh will apt-get install it."
  note "If something else is bound to :80, that install will fail to start"
  note "and bootstrap.sh (set -e) aborts partway through."
fi

sub "sites-available / sites-enabled / conf.d"
run sh -c 'ls -l /etc/nginx/sites-available/ 2>/dev/null || echo "no sites-available"'
run sh -c 'ls -l /etc/nginx/sites-enabled/ 2>/dev/null || echo "no sites-enabled"'
run sh -c 'ls -l /etc/nginx/conf.d/ 2>/dev/null || echo "no conf.d"'
run sh -c 'ls -l /etc/nginx/snippets/ 2>/dev/null || echo "no snippets dir"'

sub "IS THE DEFAULT SITE ENABLED, AND WHAT DOES IT SERVE"
# deploy/README.md step 4 says: sudo rm -f /etc/nginx/sites-enabled/default
# If WorkshopOne is published through that file, that command takes it offline.
if [ -e /etc/nginx/sites-enabled/default ]; then
  note "/etc/nginx/sites-enabled/default EXISTS -> $(readlink -f /etc/nginx/sites-enabled/default 2>/dev/null)"
  note "its listen / server_name / root / proxy_pass lines:"
  grep -nE '^[[:space:]]*(listen|server_name|root|proxy_pass|return|rewrite|alias)' \
    "$(readlink -f /etc/nginx/sites-enabled/default 2>/dev/null)" 2>/dev/null | sed 's/^/      /'
  note ""
  note ">>> If any proxy_pass above points at :1929, DO NOT run"
  note "    'rm -f /etc/nginx/sites-enabled/default' from deploy/README.md step 4."
else
  note "no /etc/nginx/sites-enabled/default (the README's rm is a no-op)"
fi

sub "effective config: listen / server_name / proxy_pass / root only"
# `nginx -T` parses and dumps; it does not reload. Filtered so we never print
# auth files, keys or anything but routing.
if have nginx; then
  nginx -T 2>/dev/null \
    | grep -nE '^[[:space:]]*(#[[:space:]]*configuration file|server_name|listen|proxy_pass|root|server[[:space:]]*\{|ssl_certificate[[:space:]])' \
    | sed 's/^/    /' | head -200
else
  miss "nginx not installed"
fi

sub "COLLISION CHECK: directives cloudflare-realip.sh would redefine"
# cloudflare-realip.sh writes /etc/nginx/conf.d/cloudflare-realip.conf containing
#   map $http_x_forwarded_proto $cf_forwarded_proto { ... }
#   map $http_upgrade $connection_upgrade { ... }
#   real_ip_header CF-Connecting-IP;  set_real_ip_from <cf ranges>;
# A `map` may be declared only ONCE per http context. If WorkshopOne's config
# already defines $connection_upgrade (the standard Node websocket snippet),
# nginx refuses to start with "duplicate map" and BOTH sites go down.
if have nginx; then
  note "existing 'map \$http_upgrade \$connection_upgrade' declarations:"
  show "none found" "nginx -T | grep -nE 'map[[:space:]]+.http_upgrade|.connection_upgrade'"
  note "existing '\$cf_forwarded_proto' declarations:"
  show "none found" "nginx -T | grep -n 'cf_forwarded_proto'"
  note "existing real_ip config (this applies http-wide, i.e. to WorkshopOne too):"
  show "none found" "nginx -T | grep -nE 'real_ip_header|set_real_ip_from|real_ip_recursive' | head -20"
  note "every other 'map' block (they all share one namespace):"
  show "none found" "nginx -T | grep -nE '^[[:space:]]*map[[:space:]]+.'"
else
  miss "nginx not installed — no map collision possible yet"
fi

sub "nginx worker user and log locations"
run sh -c 'grep -hE "^[[:space:]]*(user|error_log|access_log|include)" /etc/nginx/nginx.conf 2>/dev/null'

# =============================================================================
sec "8. WORKSHOPONE"
# =============================================================================
WSO_PID="$(pid_on_port 1929)"

sub "process listening on :1929"
if [ -n "$WSO_PID" ]; then
  note "PID = $WSO_PID"
  run sh -c "ps -o pid,ppid,user,group,etime,rss,nice,args -p $WSO_PID"
  note "runs as user     : $(ps -o user= -p "$WSO_PID" 2>/dev/null | tr -d ' ')"
  note "executable       : $(readlink -f /proc/$WSO_PID/exe 2>/dev/null || echo 'need root')"
  note "working dir      : $(readlink -f /proc/$WSO_PID/cwd 2>/dev/null || echo 'need root')"
  note ""
  note ">>> If 'executable' above is /usr/bin/node, WorkshopOne uses the SYSTEM"
  note "    node and bootstrap.sh's Node 24 upgrade will change it underneath."
else
  note "nothing is listening on :1929 right now."
  note "WorkshopOne may be stopped, on another port, or bound to a unix socket."
fi

sub "environment KEY NAMES of the :1929 process (values never printed)"
if [ -n "$WSO_PID" ] && [ -r "/proc/$WSO_PID/environ" ]; then
  tr '\0' '\n' < "/proc/$WSO_PID/environ" 2>/dev/null \
    | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/      \1/p' | sort -u
  note ""
  note ">>> Look for SERVICE_PLANNER_TOKEN (or similar). The fuel bootstrap"
  note "    generates a NEW random FUEL_PORTAL_TOKEN; if WorkshopOne already"
  note "    holds a token to call /api/portal/*, the new one will not match."
else
  miss "cannot read /proc/$WSO_PID/environ (need root, or process not found)"
fi

sub "files the :1929 process currently has OPEN (databases show up here)"
if [ -n "$WSO_PID" ] && [ -r "/proc/$WSO_PID/fd" ]; then
  show "no .db/.sqlite handles open at this instant (it may open per-query)" \
       "ls -l /proc/$WSO_PID/fd | grep -iE '[.]db|[.]sqlite|[.]sock'"
elif have lsof && [ -n "$WSO_PID" ]; then
  show "no database handles reported by lsof" \
       "lsof -p $WSO_PID | grep -iE '[.]db|[.]sqlite'"
else
  miss "cannot inspect open files (need root, or process not found)"
fi

sub "install directories that look like WorkshopOne"
show "no directory matched *workshop* / *master*system* / *service*planner*" \
     "$( have timeout && printf 'timeout 60 ' )find /opt /srv /var/www /home /root /usr/local/share /data -maxdepth 5 \\( -iname '*workshop*' -o -iname '*master*system*' -o -iname '*service*planner*' \\) 2>/dev/null | head -40"

sub "SQLite databases on this box"
note "(stat only — this script never opens a database)"
WSO_DBS="$(tmo 90 find /opt /srv /var /home /root /usr/local /data -xdev -type f \
  \( -iname '*.db' -o -iname '*.sqlite' -o -iname '*.sqlite3' \) 2>/dev/null | head -60)"
if [ -n "$WSO_DBS" ]; then
  printf '%s\n' "$WSO_DBS" | while read -r f; do
    printf '\n'
    db_report "$f"
  done
else
  note "no .db/.sqlite files found in the searched roots"
fi
note ""
note ">>> For each candidate WorkshopOne database above, check THREE things:"
note "    1. owner:group and mode of the FILE"
note "    2. owner:group and mode of the PARENT DIRECTORY"
note "    3. whether a -wal exists"
note "    The fuel app opens it with better-sqlite3 {readonly:true}. On a WAL"
note "    database even a read-only connection must be able to create/attach"
note "    the -shm file, which needs WRITE permission on the file AND the"
note "    directory. A 0600 root-owned db in a 0700 root-owned dir cannot be"
note "    read by the fuelapp user at all."

sub "config / env files near WorkshopOne (KEY NAMES ONLY)"
# Space-safe: WorkshopOne's directory may well contain a space, the way
# "D:/Master system 1" does on the Windows box.
{
  printf '%s\n' "$WSO_DBS" | while IFS= read -r f; do
    [ -n "$f" ] && dirname "$f"
  done
  printf '%s\n' /opt/workshopone /opt/WorkshopOne /srv/workshopone /var/www/workshopone
} | sort -u | while IFS= read -r d; do
  [ -d "$d" ] || continue
  for f in "$d/.env" "$d/.env.local" "$d/.env.production" "$d/../.env" "$d/../.env.local"; do
    [ -f "$f" ] && { printf '\n'; env_keys "$f"; }
  done
done
if [ -n "$WSO_PID" ]; then
  wcwd="$(readlink -f "/proc/$WSO_PID/cwd" 2>/dev/null)"
  if [ -n "$wcwd" ]; then
    for f in "$wcwd/.env" "$wcwd/.env.local" "$wcwd/.env.production"; do
      [ -f "$f" ] && { printf '\n'; env_keys "$f"; }
    done
  fi
fi

sub "native .node modules WorkshopOne has compiled (these break on a node upgrade)"
if [ -n "$WSO_PID" ]; then
  wcwd="$(readlink -f "/proc/$WSO_PID/cwd" 2>/dev/null)"
  if [ -n "$wcwd" ] && [ -d "$wcwd" ]; then
    nmods="$(tmo 60 find "$wcwd" -name '*.node' -path '*node_modules*' 2>/dev/null | head -20)"
    if [ -n "$nmods" ]; then
      printf '%s\n' "$nmods" | sed 's/^/    /'
      note ""
      note ">>> Each of these is compiled against one NODE_MODULE_VERSION."
      note "    Upgrading the system node to 24 makes them fail to load with"
      note "    'was compiled against a different Node.js version'."
    else
      note "no native modules found under $wcwd"
    fi
  else
    miss "working directory unknown (need root)"
  fi
else
  miss "WorkshopOne process not found"
fi

sub "can WorkshopOne be reached on loopback (read-only HEAD request)"
if have curl; then
  note "http://127.0.0.1:1929/  -> HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:1929/ 2>/dev/null || echo 'no answer')"
else
  miss "curl not installed"
fi

# =============================================================================
sec "9. TLS CERTIFICATES AND RENEWAL"
# =============================================================================
sub "certbot"
if have certbot; then
  note "certbot : $(command -v certbot)  $(certbot --version 2>&1 | head -1)"
  run sh -c 'certbot certificates 2>&1 | head -60'
else
  note "certbot not on PATH"
  have snap && run sh -c 'snap list 2>/dev/null | grep -i certbot || echo "no certbot snap"'
fi

sub "existing certificate material"
run sh -c 'ls -l /etc/letsencrypt/live/ 2>/dev/null || echo "no /etc/letsencrypt/live"'
run sh -c 'ls -l /etc/letsencrypt/renewal/ 2>/dev/null || echo "no renewal configs"'
run sh -c 'ls -ld /etc/ssl/cloudflare /etc/ssl/private 2>/dev/null'
run sh -c 'ls -l /etc/ssl/certs/*.pem 2>/dev/null | grep -viE "ca-certificates|/etc/ssl/certs/[0-9a-f]{8}" | head -20 || echo "no obvious custom certs in /etc/ssl/certs"'

sub "renewal timers / cron"
have systemctl && run sh -c 'systemctl list-timers --all --no-pager 2>/dev/null | grep -iE "certbot|acme|renew" || echo "no certbot timer"'
run sh -c 'ls -l /etc/cron.d/certbot /etc/cron.daily/certbot 2>/dev/null || echo "no certbot cron files"'

sub "ACME webroot in use (the README deletes the default site, which may own it)"
if have nginx; then
  show "no acme-challenge location in the nginx config" \
       "nginx -T | grep -nE 'well-known|acme-challenge'"
fi

# =============================================================================
sec "10. FIREWALL"
# =============================================================================
sub "ufw"
if have ufw; then
  run sh -c 'ufw status verbose 2>&1'
  note ""
  note ">>> If ufw is ACTIVE and port 1929 is not allowed, WorkshopOne is"
  note "    already loopback/proxy-only — fine. If ufw is INACTIVE, note that"
  note "    bootstrap.sh STAGES allow rules for OpenSSH/80/443 and a deny for"
  note "    3300, then asks YOU to run 'ufw enable'. Enabling it will drop"
  note "    every port not in that list, including 1929 from outside."
else
  note "ufw not installed"
fi

sub "iptables / nftables (read-only dumps)"
if [ "$(id -u)" = "0" ]; then
  have iptables && run sh -c 'iptables -S 2>/dev/null | head -60'
  have ip6tables && run sh -c 'ip6tables -S 2>/dev/null | head -30'
  have nft && run sh -c 'nft list ruleset 2>/dev/null | head -80'
else
  miss "need root to read firewall rules"
fi

sub "cloud-level firewall"
note "20.204.51.43 is an Azure address. An Azure Network Security Group sits"
note "OUTSIDE this box and is NOT visible from here. Check the Azure portal"
note "separately for inbound rules on 80, 443, 1929 and 3300."

# =============================================================================
sec "11. SCHEDULED WORK — CRON AND TIMERS"
# =============================================================================
sub "per-user crontabs"
if [ "$(id -u)" = "0" ]; then
  while IFS=: read -r u _ uid _; do
    c="$(crontab -l -u "$u" 2>/dev/null | grep -vE '^[[:space:]]*(#|$)')"
    [ -n "$c" ] && { note "----- crontab for $u (uid $uid) -----"; printf '%s\n' "$c" | sed 's/^/      /'; }
  done < /etc/passwd
  note "(users not listed above have no crontab)"
else
  note "----- crontab for $(id -un) -----"
  run sh -c 'crontab -l 2>/dev/null || echo "none"'
  miss "need root to read other users' crontabs"
fi

sub "system cron"
run sh -c 'cat /etc/crontab 2>/dev/null | grep -vE "^[[:space:]]*(#|$)"'
run sh -c 'ls -l /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ 2>/dev/null'
run sh -c 'grep -rhE "^[^#]" /etc/cron.d/ 2>/dev/null | head -30'

sub "systemd timers"
have systemctl && run sh -c 'systemctl list-timers --all --no-pager 2>/dev/null | head -30'

# =============================================================================
sec "12. FUEL-SYSTEM PATHS AND IDENTITIES — ALREADY PRESENT?"
# =============================================================================
sub "paths the deployment will create or overwrite"
for p in /var/www/fuelsystem \
         /var/lib/fuel-system \
         /var/lib/fuel-system/app.db \
         /var/lib/fuel-system/uploads \
         /var/backups/fuel-system \
         /etc/nginx/sites-available/fuelsystem \
         /etc/nginx/sites-enabled/fuelsystem \
         /etc/nginx/snippets/fuelsystem-proxy.conf \
         /etc/nginx/conf.d/cloudflare-realip.conf \
         /home/fuelapp; do
  if [ -e "$p" ]; then
    printf '    EXISTS   %s\n' "$p"
    stat -c '             owner=%U:%G mode=%a size=%s mtime=%y' "$p" 2>/dev/null
  else
    printf '    absent   %s\n' "$p"
  fi
done

sub "the fuelapp user and group"
if id fuelapp >/dev/null 2>&1; then
  note "fuelapp EXISTS: $(id fuelapp)"
  note "home  : $(getent passwd fuelapp | cut -d: -f6)"
  note "shell : $(getent passwd fuelapp | cut -d: -f7)"
else
  note "fuelapp does not exist (bootstrap.sh will create it)"
fi

sub "all non-system accounts (uid >= 1000)"
run sh -c "awk -F: '\$3>=1000 && \$3<65534 {print \"    \" \$1 \"  uid=\" \$3 \"  home=\" \$6 \"  shell=\" \$7}' /etc/passwd"

sub "could fuelapp read WorkshopOne's database (permission arithmetic)"
if [ -n "$WSO_DBS" ]; then
  printf '%s\n' "$WSO_DBS" | while read -r f; do
    d="$(dirname "$f")"
    fo="$(stat -c '%U:%G:%a' "$f" 2>/dev/null)"
    do_="$(stat -c '%U:%G:%a' "$d" 2>/dev/null)"
    printf '    %s\n        file %s   dir %s\n' "$f" "$fo" "$do_"
  done
  note ""
  note "A future 'fuelapp' is in no shared group yet. Unless the mode grants"
  note "world read on the file AND world execute+read on the directory, the"
  note "sync cannot open it — and on a WAL database it also needs WRITE on the"
  note "directory to create the -shm. Plan a shared group instead of 0777."
fi

sub "git / repo remnants"
run sh -c 'ls -ld /var/www/* 2>/dev/null'

# =============================================================================
sec "13. SUMMARY — PASTE THIS BACK FIRST"
# =============================================================================
_free()  { [ -z "$(port_owner "$1")" ] && printf 'FREE' || printf 'IN USE'; }
_exists(){ [ -e "$1" ] && printf 'EXISTS' || printf 'absent'; }

printf '    OS                     : %s\n' "$(grep -s '^PRETTY_NAME' /etc/os-release | cut -d'"' -f2)"
printf '    arch / kernel          : %s / %s\n' "$(uname -m 2>/dev/null)" "$(uname -r 2>/dev/null)"
printf '    timezone NOW           : %s   (bootstrap.sh would set Asia/Colombo)\n' "$( { timedatectl show -p Timezone --value 2>/dev/null; } || cat /etc/timezone 2>/dev/null || echo '?')"
printf '    RAM total / available  : %s\n' "$(free -h 2>/dev/null | awk '/^Mem:/{print $2" / "$7}')"
printf '    swap                   : %s\n' "$(free -h 2>/dev/null | awk '/^Swap:/{print $2}')"
printf '    disk free /            : %s\n' "$(df -h / 2>/dev/null | awk 'NR==2{print $4" of "$2}')"
printf '    disk free /var         : %s\n' "$(df -h /var 2>/dev/null | awk 'NR==2{print $4" of "$2}')"
printf '    node -v                : %s   at %s\n' "$(node -v 2>/dev/null || echo 'not installed')" "$(readlink -f "$(command -v node 2>/dev/null)" 2>/dev/null || echo '-')"
printf '    WorkshopOne node       : %s\n' "$( [ -n "$WSO_PID" ] && readlink -f "/proc/$WSO_PID/exe" 2>/dev/null || echo 'unknown')"
printf '    WorkshopOne runs as    : %s\n' "$( [ -n "$WSO_PID" ] && ps -o user= -p "$WSO_PID" 2>/dev/null | tr -d ' ' || echo 'unknown')"
printf '    port 3300              : %s\n' "$(_free 3300)"
printf '    port 1929              : %s\n' "$(_free 1929)"
printf '    port 80                : %s\n' "$(_free 80)"
printf '    port 443               : %s\n' "$(_free 443)"
printf '    nginx installed        : %s\n' "$(have nginx && echo "yes ($(systemctl is-active nginx 2>/dev/null))" || echo no)"
printf '    nginx default site     : %s\n' "$(_exists /etc/nginx/sites-enabled/default)"
printf '    $connection_upgrade    : %s\n' "$(have nginx && { nginx -T 2>/dev/null | grep -q 'connection_upgrade' && echo 'ALREADY DEFINED — cloudflare-realip.sh will duplicate it' || echo 'not defined (safe)'; } || echo 'n/a')"
printf '    pm2 daemons            : %s\n' "$(ps -eo user,args 2>/dev/null | grep -ci '[P]M2.*God')"
printf '    ufw                    : %s\n' "$(have ufw && ufw status 2>/dev/null | head -1 || echo 'not installed')"
printf '    fuelapp user           : %s\n' "$(id fuelapp >/dev/null 2>&1 && echo EXISTS || echo absent)"
printf '    /var/www/fuelsystem    : %s\n' "$(_exists /var/www/fuelsystem)"
printf '    /var/lib/fuel-system   : %s\n' "$(_exists /var/lib/fuel-system)"

printf '\n\n'
printf '=======================================================================\n'
printf ' SURVEY COMPLETE — nothing was changed.\n'
printf ' Report saved to: %s\n' "$REPORT"
printf ' It contains paths, versions and env KEY NAMES. No secret values.\n'
printf ' Skim it once before pasting, then send it back.\n'
printf '=======================================================================\n'

# The whole script writes through `exec > >(tee ...)`. Give that background tee
# a moment to drain before the shell returns, or the tail of the report can be
# interleaved with your prompt.
sleep 1
