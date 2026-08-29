# E&C Fuel System — Production Deployment Runbook

Target: `fuelsystem.ec-workshops.online` → Cloudflare (proxied) → origin `20.204.51.43` → nginx → `127.0.0.1:3300` → Next.js 16.2.7 under PM2 → SQLite at `/var/lib/fuel-system/app.db`.

Two parts. **Part A runs on your Windows workstation and changes the repo.** **Part B runs on the Ubuntu VPS and changes the server.** Do not interleave them.

---

## Decide this first

**Your live database is published on the public internet, and you must decide right now whether you accept that or stop it before anything else happens.**

`data/app.db` (20.7 MB in HEAD), `service-record-data.db` (1.5 MB, contains password hashes/salts and two live 64-char session bearer tokens) and `data/fuel-data-export.json` are **tracked in git**, and the GitHub repo `yohan114/Fuel-System-V2` is public. Verified in this worktree: `git ls-files` returns all three, `.gitignore` is 71 lines, contains **no** `*.db` rule (only `*.db-shm` / `*.db-wal` / `data/app.db.backup-*`), and `git check-ignore -v data/app.db` matches nothing. The brief's "line 76 comment" does not exist.

Anyone who has cloned the repo holds: 12 bcrypt password hashes including 3 ADMIN accounts (`admin`, `malinga`, `nihal`), 539 bills totalling LKR 140,982,458.68, 587 rental rates, 773 assets with reg/chassis/serial numbers, 13,142 fuel issues, and 2,545 audit rows.

The decision: **make the repo private now, treat all 14 credentials and both session tokens as compromised, and rotate them in step 25.** Making it private does not un-leak anything already taken and does not retract existing forks — it only stops new exposure. If you decide instead to keep the repo public, you must not put the live database back in it and you must still rotate. History purge is a separate, later call (see the end of this document); do not let it block deployment.

Do step 1 before you read further.

---

# PART A — IN THE REPO (workstation)

Working directory for all of Part A: `D:/Fuel system server side/fuelsystem`

### 1. Stop new exposure: make the repo private

```bash
gh auth status
gh repo view yohan114/Fuel-System-V2 --json visibility,forkCount,isFork
gh api repos/yohan114/Fuel-System-V2/forks --jq '.[].full_name'

gh repo edit yohan114/Fuel-System-V2 --visibility private --accept-visibility-change-consequences
gh repo view yohan114/Fuel-System-V2 --json visibility
```

**Check:** `visibility` reads `private`. If `forkCount` was above 0, note the fork names — privatising does **not** remove them; they stay public and only a GitHub Support ticket removes them.

---

### 2. Untrack the live databases and add the ignore rules in the same commit

```bash
cd "D:/Fuel system server side/fuelsystem"
git checkout -b chore/production-hardening

git rm --cached data/app.db
git rm --cached service-record-data.db
git rm --cached data/fuel-data-export.json

cat >> .gitignore <<'EOF'

# Live databases — they ship out of band, never through git.
# A git pull/checkout on the server WILL overwrite or delete a tracked database.
data/app.db
data/app-ship.db
service-record-data.db
data/fuel-data-export.json
EOF

git add .gitignore
git check-ignore -v data/app.db service-record-data.db data/fuel-data-export.json
git status --short
```

**Check:** `git check-ignore` prints a matching rule for all three. `git status --short` lists no `.db` file as untracked. `git rm --cached` without the ignore rules leaves them ready to be silently re-committed by the next `git add -A`.

**On the fresh VPS this is safe.** On any machine that already has a checkout with the live DB inside the tree, taking this commit **deletes** `data/app.db` on pull — that is why the database moves out of the tree (step 13) before the server ever takes this commit.

---

### 3. Fix the backup paths — they currently back up the wrong file

`src/lib/backup/snapshot.ts:17` defaults `dbPath` to `process.cwd()/data/app.db` and never consults `FUEL_DATABASE_URL`/`DATABASE_URL`; `src/app/api/cron/backup/route.ts:26` calls it with no argument. Once the DB lives at `/var/lib/fuel-system/app.db`, every nightly backup either throws `Database not found` or snapshots a stale/empty file — and `route.ts:49-56` writes a success row to `AuditLog` either way. Fix this **before** the database moves.

Edit `src/lib/backup/snapshot.ts`:

```ts
// add near the top, after the imports
export function liveDbPath(): string {
  const url =
    process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  let f = url.replace(/^file:/, "");
  while (f.startsWith("//")) f = f.slice(1);
  return path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
}

// replace the signature
export async function snapshotDatabase(dbPath = liveDbPath()): Promise<Snapshot> {
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found at ${dbPath}`);
  ...
  // and the temp file must live beside the DB, not under cwd:
  const tmp = path.join(path.dirname(dbPath), `.backup-tmp-${process.pid}.db`);
```

Then point the other two call sites at the same resolver:

```bash
# scripts/backup.ts:8         -> import { liveDbPath } and use it instead of the hardcode
# src/app/actions/admin.ts:189-190 -> same
```

```bash
npm run typecheck && npm test
```

**Check:** typecheck and tests pass, and `grep -rn "process.cwd(), \"data\", \"app.db\"" src scripts` returns nothing.

---

### 4. Fix `next.config.ts` ALLOWED_ORIGINS — bare hosts only

Verified against Next 16.2.7's own matcher: `action-handler.js` compares `new URL(origin).host`, which never contains a scheme. So every scheme-prefixed entry in the current array is **inert dead weight**, and `http://192.168.8.200:3300` never matches — a live latent bug for LAN site machines. `*.ec-workshops.online` does already match `fuelsystem.ec-workshops.online`, so forms would work today; add the literal anyway so a future edit to the wildcard cannot silently kill production forms.

Replace the array in `next.config.ts`:

```ts
// Next compares against `new URL(origin).host` — NEVER include a scheme here.
const ALLOWED_ORIGINS = [
  "fuelsystem.ec-workshops.online",
  "fuel.portal.ec-workshops.online",
  "fuel-portal.ec-workshops.online",
  "*.ec-workshops.online",          // matches exactly one label; does NOT match the apex
  "*.portal.ec-workshops.online",
  "localhost",
  `localhost:${PORT}`,
  `192.168.8.200:${PORT}`,          // host:port, no scheme
];
```

```bash
node -e "const{isCsrfOriginAllowed}=require('next/dist/server/app-render/csrf-protection.js');console.log(isCsrfOriginAllowed('fuelsystem.ec-workshops.online',['*.ec-workshops.online','fuelsystem.ec-workshops.online']))"
```

**Check:** prints `true`. This is baked into the server bundle at build time — a PM2 restart alone will not pick it up, you must rebuild.

---

### 5. Pin Node, declare `dotenv`, retarget the deploy script

`scripts/deploy-to-vps.sh:26` defaults `BRANCH` to `claude/wonderful-hypatia-yi703x`, which is 6 commits behind `main`. Line 158 is `git checkout -f -B "$BRANCH"` — running it unedited force-rolls production back nine days. `prisma.config.ts:3` does `import "dotenv/config"` but `dotenv` is not in `package.json`; it only resolves because it is hoisted via c12, so any Prisma bump breaks every CLI command on the server.

```bash
cd "D:/Fuel system server side/fuelsystem"
echo "24" > .nvmrc
npm install --save-dev dotenv
sed -i 's|BRANCH="${BRANCH:-claude/wonderful-hypatia-yi703x}"|BRANCH="${BRANCH:-main}"|' scripts/deploy-to-vps.sh
grep -n '^BRANCH=' scripts/deploy-to-vps.sh
```

**Check:** `grep` shows `BRANCH="${BRANCH:-main}"`, `.nvmrc` contains `24`, `dotenv` appears in `devDependencies`.

---

### 6. Gate, commit, push

```bash
npm run typecheck && npm test && npm run build
git add -A
git status --short          # must NOT list any .db file
git commit -m "Untrack live databases, resolve backup path from DATABASE_URL, fix allowed origins, pin Node"
git push -u origin chore/production-hardening
# merge to main (PR or fast-forward) — the server deploys from main
```

**Check:** all three gates pass; `git status --short` shows no `.db`; the branch is on GitHub and merged to `main`.

---

### 7. Produce the database file that will ship to the server

SQLite is in WAL mode. `data/app.db-wal` is currently ~4.1 MB — roughly a thousand pages of the newest fuel issues, meter readings and bills that are **not yet in `app.db`**. Copying `app.db` alone loses them silently: the file opens cleanly and `integrity_check` passes. `VACUUM INTO` emits one self-contained file with no sidecars, so nothing can be lost or mismatched in transit.

Stop the local dev server and close any DB browser first.

```bash
cd "D:/Fuel system server side/fuelsystem"

npx tsx -e "const D=require('better-sqlite3');const db=new D('data/app.db');
console.log('integrity:',JSON.stringify(db.pragma('integrity_check')));
console.log('checkpoint:',JSON.stringify(db.pragma('wal_checkpoint(TRUNCATE)')));
db.exec(\"VACUUM INTO 'data/app-ship.db'\");
console.log('users',db.prepare('SELECT COUNT(*) c FROM User').get().c,
            'fuelIssues',db.prepare('SELECT COUNT(*) c FROM FuelIssue').get().c,
            'bills',db.prepare('SELECT COUNT(*) c FROM Bill').get().c,
            'assets',db.prepare('SELECT COUNT(*) c FROM Asset').get().c);
db.close();"

sha256sum data/app-ship.db | tee ship.sha256
ls -l data/app-ship.db
```

**Check:** `integrity_check` is `ok`; `wal_checkpoint` returns `busy: 0` (a non-zero `busy` means a writer is still attached and the checkpoint was **incomplete** — stop it and rerun, do not proceed); there is **no** `data/app-ship.db-wal` beside it. Write down the four counts and the sha256 — you will compare them on the server.

---

# PART B — ON THE SERVER (fresh Ubuntu 22.04 / 24.04)

Placeholders you must supply: `<ADMIN_IP>` (your office/home public IP for SSH), `<RESOURCE_GROUP>`, `<NSG_NAME>`, `<BACKUP_HOST>`.

### 8. Base packages, timezone, unattended security updates

Purpose: get the OS to a known state and put the box on Colombo time before anything writes a date.

```bash
ssh <YOUR_SSH_USER>@20.204.51.43

sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y curl ca-certificates git sqlite3 build-essential python3 \
  pkg-config nginx ufw rsync unattended-upgrades
sudo timedatectl set-timezone Asia/Colombo
sudo dpkg-reconfigure --priority=low unattended-upgrades   # accept defaults
timedatectl | grep 'Time zone'
```

**Check:** `Time zone: Asia/Colombo`. `sqlite3 --version` prints a version — without it `scripts/deploy-to-vps.sh` silently degrades from a safe `.backup` to an unsafe `cp`. Some billing code (`src/lib/assignments/overlaps.ts:25`, `src/lib/assignments.ts:59,64`, `src/lib/breakdowns.ts:52`) derives day keys from server-local time, so a UTC host would shift day boundaries by 5.5 hours.

---

### 9. Install Node 24 LTS and PM2

Purpose: Node 24 is the tightest common version and matches your dev box (v24.14.0), so the better-sqlite3 ABI is identical to what you test against. Prisma 7.8.0 requires `^20.19 || ^22.12 || >=24.0` — it excludes Node 20.0–20.18 and 22.0–22.11.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
node -v && npm -v && pm2 -v
```

**Check:** `node -v` prints `v24.x`. Do not use Alpine/musl (no better-sqlite3 prebuilds) or odd-numbered Node releases.

---

### 10. Create the app user and the directories

Purpose: one identity owns the app, the database, the `.env` and the backups — mixed ownership on a WAL database is the classic "attempt to write a readonly database" failure.

**If PM2 already runs other apps on this box, do not create a new user — use the existing PM2 user and substitute it below.** Check with `pm2 list` / `ps -o user= -C PM2`.

```bash
sudo useradd -m -d /home/fuelapp -s /bin/bash fuelapp

sudo mkdir -p /var/www/fuelsystem /var/lib/fuel-system/uploads /var/backups/fuel-system
sudo chown -R fuelapp:fuelapp /var/www/fuelsystem /var/lib/fuel-system /var/backups/fuel-system
sudo chmod 750 /var/lib/fuel-system
sudo chmod 750 /var/backups/fuel-system
ls -ld /var/lib/fuel-system /var/www/fuelsystem
```

**Check:** both directories exist and are owned by `fuelapp`. The **directory** must be writable, not just the `.db` file — SQLite creates `app.db-wal` and `app.db-shm` next to the database and will not create them in a read-only directory.

---

### 11. Clone the code

```bash
sudo -u fuelapp git clone https://github.com/yohan114/Fuel-System-V2.git /var/www/fuelsystem
cd /var/www/fuelsystem
sudo -u fuelapp git checkout main
git log --oneline -3
ls data/ 2>/dev/null
```

**Check:** the log tip matches what you pushed in step 6, and `data/` contains **no** `app.db` (step 2 untracked it). The repo is private now, so you will be prompted for credentials — use a fine-grained deploy token or an SSH deploy key, not your account password.

---

### 12. Create `/var/www/fuelsystem/.env`

Purpose: the app, the Prisma CLI and every maintenance script must all resolve the same absolute database path. `.env` is gitignored, so it never arrives by pull — it must be created by hand.

`src/lib/db.ts:20` prefers `FUEL_DATABASE_URL`; `prisma.config.ts:13` reads **only** `DATABASE_URL`. Set both to the same absolute path so they cannot diverge.

Generate secrets first (on this box):

```bash
node -e "console.log('FUEL_AUTH_SECRET='+require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('FUEL_PORTAL_TOKEN='+require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('SEED_ADMIN_PASSWORD='+require('crypto').randomBytes(12).toString('base64url'))"
```

```bash
sudo -u fuelapp tee /var/www/fuelsystem/.env >/dev/null <<'EOF'
NODE_ENV=production
TZ=Asia/Colombo
PORT=3300

# Absolute, and BOTH names — the app reads FUEL_DATABASE_URL, the Prisma CLI reads DATABASE_URL.
DATABASE_URL="file:/var/lib/fuel-system/app.db"
FUEL_DATABASE_URL="file:/var/lib/fuel-system/app.db"

FUEL_AUTH_SECRET="<PASTE_GENERATED>"
CRON_SECRET="<PASTE_GENERATED>"
FUEL_PORTAL_TOKEN="<PASTE_GENERATED>"
SEED_ADMIN_PASSWORD="<PASTE_GENERATED>"

UPLOADS_DIR=/var/lib/fuel-system/uploads
# WorkshopOne is not on this host — see step 21.
EOF

sudo chown fuelapp:fuelapp /var/www/fuelsystem/.env
sudo chmod 600 /var/www/fuelsystem/.env
sudo -u fuelapp grep -c '' /var/www/fuelsystem/.env
```

**Check:** file mode is `600`, owner `fuelapp`, and no placeholder `<PASTE_GENERATED>` remains (`grep PASTE /var/www/fuelsystem/.env` returns nothing). `FUEL_AUTH_SECRET` **must** be set: `src/lib/auth-secret.ts` throws in production when it is unset or equals the dev fallback, but `getSecret()` is lazy — the site boots and renders `/login` fine and only 500s when someone tries to sign in.

---

### 13. Ship the database into `/var/lib/fuel-system/`

Purpose: put the live data **outside the git tree**, permanently. This is the single structural decision that makes the update loop safe.

From the workstation:

```bash
scp "D:/Fuel system server side/fuelsystem/data/app-ship.db" <YOUR_SSH_USER>@20.204.51.43:/tmp/app-ship.db
```

On the server:

```bash
sudo mv /tmp/app-ship.db /var/lib/fuel-system/app.db
sudo chown fuelapp:fuelapp /var/lib/fuel-system/app.db
sudo chmod 640 /var/lib/fuel-system/app.db

sha256sum /var/lib/fuel-system/app.db
sqlite3 /var/lib/fuel-system/app.db "PRAGMA integrity_check;"
sqlite3 /var/lib/fuel-system/app.db \
 "SELECT (SELECT COUNT(*) FROM User)||' users, '||(SELECT COUNT(*) FROM FuelIssue)||' fuelIssues, '||(SELECT COUNT(*) FROM Bill)||' bills, '||(SELECT COUNT(*) FROM Asset)||' assets';"
```

**Check:** the sha256 equals `ship.sha256` from step 7, `integrity_check` is `ok`, and the four counts match exactly what step 7 printed. Any mismatch — stop and re-ship; do not "fix it later".

---

### 14. Install dependencies, generate the Prisma client, inspect migrations

Purpose: `better-sqlite3` is a native module. The binary in your Windows `node_modules` is a `PE32+ .dll` and will throw an invalid-ELF-header error on Linux, surfacing as a 500 on every page. It must be built here.

```bash
cd /var/www/fuelsystem
sudo -u fuelapp npm ci
file node_modules/better-sqlite3/build/Release/better_sqlite3.node

sudo -u fuelapp npx prisma generate

# READ-ONLY inspection first, always:
sudo -u fuelapp env DATABASE_URL="file:/var/lib/fuel-system/app.db" npx prisma migrate status
```

**Check:** `file` reports `ELF 64-bit LSB shared object, x86-64` — **not** a Windows DLL. `migrate status` should report `Database schema is up to date!` (the shipped DB has 33 `_prisma_migrations` rows, and the one failed `20260614114648_add_billing_models` row has `rolled_back_at` set so P3009 does not fire).

- If it says **up to date**: skip `migrate deploy`, there is nothing to apply.
- If it lists **pending** migrations: `sudo -u fuelapp env DATABASE_URL="file:/var/lib/fuel-system/app.db" npx prisma migrate deploy`
- If that dies with **P3018 "table … already exists"**: the schema came from `db push` and the history is empty. Run the prepared cure with PM2 stopped:
  ```bash
  sudo -u fuelapp env DATABASE_URL="file:/var/lib/fuel-system/app.db" npx tsx scripts/diagnose_migrations.ts
  # review, then:
  sudo -u fuelapp env DATABASE_URL="file:/var/lib/fuel-system/app.db" npx tsx scripts/diagnose_migrations.ts --apply
  ```

**Never** run `prisma migrate dev`, `migrate reset` or `db push` on this server — they drop and recreate tables. 27 of the 32 migration files have `applied_steps_count = 0`, so they are not a faithful replay script: never rebuild production from an empty database.

---

### 15. Build

Purpose: produce `.next`. The build loads the page module graph, and `src/lib/db.ts:33` runs `PRAGMA journal_mode=WAL` at module scope — so the build **connects to the database**, and if the URL were relative it would quietly create an empty `data/app.db` that `next start` would then happily serve.

```bash
cd /var/www/fuelsystem
sudo -u fuelapp bash -c 'set -a; . ./.env; set +a; npm run build'
ls -la /var/www/fuelsystem/data/ 2>/dev/null
```

**Check:** the build succeeds and `/var/www/fuelsystem/data/` contains **no** `app.db`. If one appeared, `DATABASE_URL` was not absolute — delete it, fix `.env`, rebuild.

---

### 16. Run it under PM2 — fork mode, exactly one instance, loopback bind

Purpose: a supervised, single-instance process. **PM2 rather than systemd**, because this box already runs six other apps under PM2 and `scripts/deploy-to-vps.sh:104` aborts outright unless `pm2 describe fuelsystem` succeeds — a systemd unit would break the only deploy tool the repo has.

The ecosystem file lives **outside** the repo so it can never be committed and cannot be clobbered by `git checkout -f`.

```bash
sudo mkdir -p /etc/fuelsystem
sudo tee /etc/fuelsystem/ecosystem.config.js >/dev/null <<'EOF'
module.exports = {
  apps: [{
    name: "fuelsystem",
    cwd: "/var/www/fuelsystem",
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3300 -H 127.0.0.1",
    instances: 1,       // MUST stay 1 — schedulers run in-process
    exec_mode: "fork",  // NOT cluster
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      TZ: "Asia/Colombo",
      PORT: "3300",
      DATABASE_URL: "file:/var/lib/fuel-system/app.db",
      FUEL_DATABASE_URL: "file:/var/lib/fuel-system/app.db"
    }
  }]
};
EOF
sudo chown fuelapp:fuelapp /etc/fuelsystem/ecosystem.config.js

sudo -u fuelapp pm2 start /etc/fuelsystem/ecosystem.config.js
sudo -u fuelapp pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u fuelapp --hp /home/fuelapp
# run the command that pm2 startup prints

sudo -u fuelapp pm2 describe fuelsystem | grep -E 'status|exec mode|instances|script args'
ss -ltnp | grep 3300
```

**Check:** status `online`, exec mode `fork`, 1 instance, and `ss` shows `127.0.0.1:3300` — **not** `0.0.0.0:3300`. Secrets stay in `.env` (mode 600) and are loaded by Next at runtime; never put them in the ecosystem file. Cluster mode would run N copies of the in-process price scheduler and the 5-minute WorkshopOne poller against one SQLite file (`src/instrumentation.ts:4-14`), producing duplicate syncs and `SQLITE_BUSY`.

---

### 17. Prove the app is alive on loopback before touching nginx

```bash
curl -fsS http://127.0.0.1:3300/api/health
sudo -u fuelapp pm2 logs fuelsystem --lines 40 --nostream
sudo lsof -p "$(sudo -u fuelapp pm2 pid fuelsystem)" | grep app.db
```

**Check:** `{"ok":true,"system":"fuel",...}`. `/api/health` runs `SELECT 1` through Prisma and returns 503 on failure, so a 200 proves the native module loaded and the DB path is readable. `lsof` must show `/var/lib/fuel-system/app.db` — if it shows anything under `/var/www/fuelsystem/data/`, the environment is not reaching the process; fix that now, not later.

---

### 18. nginx: serve this hostname

Purpose: something already answers 404 on port 80 at this origin; you need a vhost for the name plus a catch-all that refuses Host-header probing of the bare IP.

```bash
grep -rn default_server /etc/nginx/ || true
nginx -V 2>&1 | grep -o with-http_realip_module
```

If another site already claims `default_server`, drop the `default_server` keywords from the catch-all block below or `nginx -t` will fail.

```bash
sudo tee /etc/nginx/conf.d/00-upgrade-map.conf >/dev/null <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
EOF

sudo tee /etc/nginx/sites-available/fuelsystem >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 80;
    listen [::]:80;
    server_name fuelsystem.ec-workshops.online;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name fuelsystem.ec-workshops.online;

    ssl_certificate     /etc/ssl/cloudflare/fuelsystem.pem;
    ssl_certificate_key /etc/ssl/cloudflare/fuelsystem.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    client_max_body_size 16m;      # server actions accept 12mb; leave framing headroom
    client_body_timeout  300s;

    gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 5; gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript
               text/javascript application/xml image/svg+xml font/ttf font/otf;

    access_log /var/log/nginx/fuelsystem.access.log;
    error_log  /var/log/nginx/fuelsystem.error.log;

    location / {
        proxy_pass http://127.0.0.1:3300;
        proxy_http_version 1.1;

        # Host MUST be the public hostname — Next compares Origin against it.
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        # Hardcoded https: this block is only reachable over TLS, and Next derives
        # nextUrl.protocol from this header when proxy.ts issues a redirect.
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port  443;

        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_connect_timeout 10s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
        proxy_buffering on; proxy_buffer_size 16k; proxy_buffers 8 16k;
        proxy_redirect off;
    }
}
EOF

# real client IPs from Cloudflare (regenerate periodically — ranges change)
{ printf '# generated %s\n' "$(date -u)";
  curl -s https://www.cloudflare.com/ips-v4; echo;
  curl -s https://www.cloudflare.com/ips-v6; } \
  | sed '/^#/!{/^$/!s|^|set_real_ip_from |; /^$/!s|$|;|}' \
  | sudo tee /etc/nginx/conf.d/01-cloudflare-realip.conf >/dev/null
echo 'real_ip_header CF-Connecting-IP;' | sudo tee -a /etc/nginx/conf.d/01-cloudflare-realip.conf

sudo mkdir -p /var/www/certbot
sudo ln -sf /etc/nginx/sites-available/fuelsystem /etc/nginx/sites-enabled/fuelsystem
sudo rm -f /etc/nginx/sites-enabled/default    # only if it owns the current 404
```

Do **not** run `nginx -t` yet — the certificate does not exist. Continue to step 19, then test.

**Check:** `nginx -V` confirms `with-http_realip_module`, and you know which config currently owns `default_server`. Never set `proxy_set_header Host $proxy_host` — that sends `127.0.0.1:3300` and pushes every server action onto the allowlist fallback.

---

### 19. TLS: Cloudflare Origin Certificate, mode Full (Strict)

Purpose: encrypt the Cloudflare→Azure hop. **Origin CA cert, not certbot** — while the record is orange-clouded, Let's Encrypt's HTTP-01 challenge is answered by Cloudflare's edge, not your origin, and step 20 firewalls LE's validators out entirely; an Origin CA cert is valid 15 years, needs no renewal timer, and public trust buys nothing because no browser ever talks to the origin directly.

In the Cloudflare dashboard: **SSL/TLS → Origin Server → Create Certificate**. Hostnames `fuelsystem.ec-workshops.online` and `*.ec-workshops.online`, RSA 2048, 15 years. Copy **both** blocks — the key is shown once.

```bash
sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/fuelsystem.pem    # paste the certificate
sudo nano /etc/ssl/cloudflare/fuelsystem.key    # paste the private key
sudo chmod 644 /etc/ssl/cloudflare/fuelsystem.pem
sudo chmod 600 /etc/ssl/cloudflare/fuelsystem.key
sudo chown root:root /etc/ssl/cloudflare/*

sudo nginx -t && sudo systemctl reload nginx
```

Then in the dashboard:

```
SSL/TLS → Overview            → Full (Strict)          [required, not preferred]
SSL/TLS → Edge Certificates   → Always Use HTTPS: ON
                              → Minimum TLS Version: 1.2
                              → Automatic HTTPS Rewrites: ON
Caching → Cache Rules         → URI Path starts with "/api/" → Bypass cache
Speed → Optimization          → Rocket Loader: OFF   (it reorders JS and breaks React hydration)
Security                      → Bot Fight Mode: OFF, or exclude /api/cron and /api/portal
DNS                           → fuelsystem  A  20.204.51.43  Proxied (orange) — keep proxied
```

Verify:

```bash
sudo nginx -t
curl -sv --resolve fuelsystem.ec-workshops.online:443:20.204.51.43 \
  https://fuelsystem.ec-workshops.online/api/health 2>&1 | grep -Ei 'subject|issuer|HTTP/'
curl -fsS https://fuelsystem.ec-workshops.online/api/health
curl -sI https://fuelsystem.ec-workshops.online/api/health | grep -Ei 'cf-ray|server'
```

**Check:** `nginx -t` passes; the direct probe shows issuer **Cloudflare Origin CA** (a local trust error there is expected and fine); the public URL returns `{"ok":true,...}` with a `cf-ray` header. **Flexible mode is not an option** — it would make Cloudflare fetch port 80, nginx 301 to HTTPS, and produce `ERR_TOO_MANY_REDIRECTS`, and it sends staff passwords in cleartext across the public internet.

---

### 20. Firewall: keep 3300 private and 80/443 Cloudflare-only

Purpose: stop anyone who learns `20.204.51.43` from bypassing Cloudflare and reaching the app in plaintext.

```bash
# --- ufw on the origin. Allow SSH FIRST or you lock yourself out. ---
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <ADMIN_IP> to any port 22 proto tcp

for c in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow from "$c" to any port 80,443 proto tcp comment 'Cloudflare'
done

sudo ufw --force enable
sudo ufw status numbered
```

```bash
# --- Azure NSG: same shape, one rule. No rule for 3300 — DenyAll default covers it. ---
az network nsg rule create -g <RESOURCE_GROUP> --nsg-name <NSG_NAME> -n allow-cloudflare-web \
  --priority 200 --access Allow --protocol Tcp --direction Inbound \
  --destination-port-ranges 80 443 \
  --source-address-prefixes 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 \
    103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
    197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 \
    172.64.0.0/13 131.0.72.0/22
# and restrict the existing SSH rule to <ADMIN_IP>
```

**Check:** `ufw status` lists 22 from your IP only and 80/443 from Cloudflare ranges only; no rule mentions 3300. `curl http://20.204.51.43` from your laptop now times out — **that is correct**, test through `https://fuelsystem.ec-workshops.online` from now on. Cloudflare cannot proxy port 3300 at all, so exposing it would only create a WAF-bypassing plaintext path.

---

### 21. Schedulers: point WorkshopOne somewhere real or switch it off

Purpose: `src/instrumentation.ts` starts two in-process jobs on every boot. The WorkshopOne default path is `D:/Master system 1/data/workshopone.db` — a Windows path that cannot exist here. It does not crash: the error is caught, but `workshop-scheduler.ts:47-48` writes `serviceSync.lastRun` and `serviceSync.lastResult` **before** checking `ok`, so a broken path costs 2 writes to the live DB every 5 minutes (576/day) forever.

```bash
# A Setting row overrides the env var — clear any stale Windows path first:
sqlite3 /var/lib/fuel-system/app.db "SELECT key,value FROM Setting WHERE key LIKE 'serviceSync%';"
sqlite3 /var/lib/fuel-system/app.db "DELETE FROM Setting WHERE key='serviceSync.dbPath';"

# WorkshopOne is not on this host — switch the poller off:
sqlite3 /var/lib/fuel-system/app.db \
  "INSERT INTO Setting(key,value) VALUES('serviceSync.enabled','false')
   ON CONFLICT(key) DO UPDATE SET value='false';"

# Price sync needs outbound HTTPS to Ceypetco (browser UA required by the site):
curl -sI -A 'Mozilla/5.0' https://ceypetco.gov.lk/historical-prices/ | head -1

sudo -u fuelapp pm2 restart fuelsystem --update-env
sudo -u fuelapp pm2 logs fuelsystem --lines 60 --nostream | grep -Ei 'workshop-sync|price-scheduler'
```

**Check:** the Ceypetco probe returns `HTTP/2 200`, and `workshop-sync failed` stops appearing in the log. The price sync only fires once the Colombo hour reaches `runHour` (default 6) and it has not already run today — silence before 06:00 is correct behaviour, not a fault.

---

### 22. Backups: hourly, verified, off-box

Purpose: this system collects continuously from paper running charts at remote sites. Losing a day means re-keying by hand. Hourly, not daily. A `cp` of a live WAL database is not a backup.

```bash
sudo tee /usr/local/bin/fuel-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DB=/var/lib/fuel-system/app.db
ROOT=/var/backups/fuel-system
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$ROOT/hourly" "$ROOT/daily" "$ROOT/monthly"
OUT="$ROOT/hourly/app-$STAMP.db"
sqlite3 "$DB" ".backup '$OUT'"                      # WAL-safe, app stays up
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -qx ok || { echo "BACKUP CORRUPT: $OUT" >&2; exit 1; }
R=$(sqlite3 "$OUT" "SELECT COUNT(*) FROM FuelIssue;")
[ "$R" -gt 10000 ] || { echo "BACKUP SUSPICIOUS: only $R fuel issues" >&2; exit 1; }
gzip -f "$OUT"
[ "$(date +%H)" = "03" ] && cp "$OUT.gz" "$ROOT/daily/" || true
[ "$(date +%d-%H)" = "01-03" ] && cp "$OUT.gz" "$ROOT/monthly/" || true
find "$ROOT/hourly"  -name '*.gz' -mmin +1500 -delete
find "$ROOT/daily"   -name '*.gz' -mtime +30   -delete
find "$ROOT/monthly" -name '*.gz' -mtime +365  -delete
EOF
sudo chown fuelapp:fuelapp /usr/local/bin/fuel-backup.sh
sudo chmod 750 /usr/local/bin/fuel-backup.sh

sudo -u fuelapp /usr/local/bin/fuel-backup.sh && ls -l /var/backups/fuel-system/hourly/
```

```bash
sudo -u fuelapp crontab -e
```
```cron
5 * * * * /usr/local/bin/fuel-backup.sh >> /var/log/fuel-backup.log 2>&1
30 3 * * * rsync -az --delete /var/backups/fuel-system/daily/ backup@<BACKUP_HOST>:/srv/fuel-backups/
```

Monthly restore drill — an untested backup is a rumour:

```bash
gunzip -c /var/backups/fuel-system/daily/app-<STAMP>.db.gz > /tmp/restore-test.db
sqlite3 /tmp/restore-test.db "PRAGMA integrity_check; SELECT COUNT(*) FROM Bill; SELECT SUM(grandTotalCents)/100.0 FROM Bill;"
rm /tmp/restore-test.db
```

**Check:** a `.gz` appears in `hourly/`, gunzips, passes `integrity_check`, and reports ~13,000+ fuel issues. On-box copies alone are not a backup — one `rm -rf` takes the database and every copy together, so the off-box rsync is mandatory. Never put an unescaped `%` in a crontab line; that is why the date logic lives in the script.

---

### 23. Wire the cron endpoints

Purpose: `docs/OPERATIONS.md` documents three crontab lines but nothing in the repo installs them. `src/instrumentation.ts` covers the price sync in-process, but **nothing schedules the backup or billing routes**. `src/proxy.ts:13-20` exempts `/api/cron` from the session check, so these are protected only by `CRON_SECRET` (500 if unset, 401 on mismatch).

Cron does not read `.env`, so use a wrapper:

```bash
sudo tee /usr/local/bin/fuel-cron.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a; . /var/www/fuelsystem/.env; set +a
curl -fsS -H "x-cron-secret: $CRON_SECRET" "http://127.0.0.1:3300/api/cron/$1${2:-}"
EOF
sudo chown fuelapp:fuelapp /usr/local/bin/fuel-cron.sh
sudo chmod 750 /usr/local/bin/fuel-cron.sh

sudo -u fuelapp /usr/local/bin/fuel-cron.sh backup
```

```bash
sudo -u fuelapp crontab -e
```
```cron
0  3 * * * /usr/local/bin/fuel-cron.sh backup '?keepDays=30' >> /var/log/fuel-cron.log 2>&1
0  6 * * * /usr/local/bin/fuel-cron.sh fuel-prices            >> /var/log/fuel-cron.log 2>&1
0  3 1 * * /usr/local/bin/fuel-cron.sh billing                >> /var/log/fuel-cron.log 2>&1
```

**Check:** the manual `backup` call returns JSON, and its `rawBytes` matches the size of `/var/lib/fuel-system/app.db` — **not** ~20 MB. If it matches 20 MB, the step-3 fix did not land and you are backing up a stale repo copy while `AuditLog` records success. `/api/cron/service-sync` exists but is disabled by step 21; do not schedule it. Google Drive upload only runs if `GDRIVE_SA_EMAIL` and `GDRIVE_SA_PRIVATE_KEY` are set — leave them unset until Drive is wanted.

---

### 24. Full verification

```bash
cd /var/www/fuelsystem
sudo -u fuelapp env FUEL_DATABASE_URL="file:/var/lib/fuel-system/app.db" npx tsx scripts/check_deployment.ts
sudo -u fuelapp env FUEL_DATABASE_URL="file:/var/lib/fuel-system/app.db" npx tsx scripts/diagnose_visibility.ts
curl -fsS https://fuelsystem.ec-workshops.online/api/health
```

Then in a browser, on `https://fuelsystem.ec-workshops.online` (never the bare IP):

1. Log in as an admin. **This is the only test that proves `FUEL_AUTH_SECRET` is right** — the app boots and renders `/login` fine with a broken secret and only 500s at sign-in.
2. Submit any form (a fuel issue). This proves the server-action origin check passes end to end.
3. Upload a correction-request attachment above ~1 MB. This proves `client_max_body_size` is not clipping the 12 MB limit.
4. Open a report export and time it.

**Check:** `check_deployment.ts` prints the resolved path as `/var/lib/fuel-system/app.db` with no `<< DOES NOT EXIST`; `diagnose_visibility.ts` does not warn that the script and the app disagree about the database. Both are read-only and safe on a live server. Note `check_deployment.ts`'s EXPECTED table is frozen at the 8 Aug 2026 state, so it validates that specific catch-up, not a generic healthy install — *more* rows than expected is normal, *fewer* means rows were skipped. **Do not smoke-test over `http://20.204.51.43`**: `next start` forces `NODE_ENV=production`, the session cookie is `Secure`, browsers refuse to store it over plain HTTP, and you get an infinite login loop that is a testing artefact, not a bug.

Cloudflare's Free-plan origin timeout is ~100 s and is not configurable — if a consolidated PDF/XLSX export exceeds that, users get a 524 even though nginx allows 300 s. Time it now; if it is slow, make it asynchronous rather than raising nginx timeouts, which cannot help.

---

### 25. Rotate every credential that was published

Purpose: the hashes and tokens in the public repo are offline in attackers' hands — no rate limit, no lockout. Nothing in steps 1–24 reduces that risk. This step does.

```bash
sqlite3 /var/lib/fuel-system/app.db "SELECT username, role, substr(passwordHash,1,7) FROM User;"
node -e "for(let i=0;i<14;i++)console.log(require('crypto').randomBytes(9).toString('base64url'))"
```

- Set a fresh password for all 12 accounts through the admin UI. Do the 3 ADMIN accounts (`admin`, `malinga`, `nihal`) first if you cannot do all today.
- `FUEL_AUTH_SECRET` was already regenerated in step 12 — that invalidates every existing session cookie, which is exactly what you want. HS256 means the signing key *is* the verification key: anyone holding the old dev secret could forge an ADMIN cookie for any user id.
- In `service-record-data.db`, DELETE both `Sessions` rows and reset the single `Users` row. Those two 64-char bearer tokens were published.
- Rotate `SEED_ADMIN_PASSWORD` (already done in step 12) and any WorkshopOne credential the tokens unlocked.

**Check:** log in with a new password; confirm the old one fails. `sqlite3 ... "SELECT COUNT(*) FROM Sessions;"` on `service-record-data.db` returns 0.

---

# Updating the system later

Your loop: develop on Windows → push → update the VPS. Code flows workstation → git → server. **Data lives only on the server** and flows server → backups. Nothing crosses.

**The trap, and why it is now prevented:** `data/app.db` used to be tracked. With a tracked database, `git pull` silently overwrites the live DB with a stale committed copy when the server file is clean; aborts with "local changes would be overwritten" when it is dirty (and the reflex fix `git checkout -- data/app.db` destroys it instantly); and a pull that includes the untrack commit **deletes** it outright. `scripts/deploy-to-vps.sh:158` runs `git checkout -f -B` — just as destructive. All three failure modes are eliminated by one fact and one fact only: **the live database is at `/var/lib/fuel-system/app.db`, outside the working tree, so git cannot touch it.** Never move it back inside the repo, for any reason.

```bash
# 1. LOCAL — develop against a COPY of production, never a pull of it
scp fuelapp@20.204.51.43:/var/backups/fuel-system/daily/<LATEST>.db.gz .
gunzip -c <LATEST>.db.gz > data/app.db          # gitignored now
npm run dev

# 2. LOCAL — gate. All three must pass.
npm run typecheck && npm test && npm run build

# 3. LOCAL — schema changes get a migration; never db push at production
npx prisma migrate dev --name <what_changed>
git add prisma/migrations && git commit -m "..."

# 4. LOCAL — confirm no database is going along for the ride
git status --short          # must list no .db
git push origin main

# 5. SERVER — one command
ssh <YOUR_SSH_USER>@20.204.51.43
cd /var/www/fuelsystem
sudo -u fuelapp bash -c 'BRANCH=main bash scripts/deploy-to-vps.sh'

# 6. VERIFY
curl -fsS http://127.0.0.1:3300/api/health
curl -fsS https://fuelsystem.ec-workshops.online/api/health
sudo -u fuelapp pm2 logs fuelsystem --lines 40 --nostream
# log in through the browser and submit one form
```

Read what the script prints. It resolves the live DB the same way `src/lib/db.ts` does, backs it up with `sqlite3 .backup` to `$HOME/fuel-db-backups/app.db.live.<STAMP>`, shows you the incoming commits, and prints the rollback line at the end. **Note that backup path — it is your rollback point.**

Facts about this loop you must hold:

- **Fuel data entered locally does not travel with the code.** It travels as `data/fuel-data-export.json`: run `npx tsx scripts/export_fuel_data.ts` on the workstation, and the deploy script replays it additively on the server. It never edits or deletes an existing row and re-running is a no-op.
- **Declining the fuel-sync prompt aborts the whole rest of the run** (alias cleanup, build, restart) after the app is already stopped — `confirm()` at line 320 calls `die()`. Answer it deliberately.
- **Lines 195–342 of the script are one-off August-2026 catch-up imports**, each guarded by `[[ -f <workbook> ]]`. They are pinned to specific months and sites. If the workbooks are not present they are skipped; do not treat them as part of a routine update.
- **The whole deploy runs with the app stopped** — PM2 stop, `npm ci`, generate, migrate, imports, build, then start. Downtime is the length of an operator-paced interactive session, not a restart. That is incompatible with "the system must keep collecting data"; schedule updates outside collection hours, or tell sites to hold entries for the window.
- **Changing `next.config.ts` requires a rebuild**, not just a restart — `allowedOrigins` is baked into the server bundle.
- **After any Node upgrade** (including a routine `apt upgrade` that bumps Node), re-run `npm ci && npx prisma generate && npm run build` or `better-sqlite3` breaks on an ABI mismatch.

---

# Rollback

Code and database are separate decisions, and usually you only need the first.

**A. Code only — no migration ran. Safe, loses nothing.** Fuel issues keyed in during the bad window survive.

```bash
cd /var/www/fuelsystem
git log --oneline -5
sudo -u fuelapp git checkout -f <LAST_GOOD_SHA>
sudo -u fuelapp npm ci && sudo -u fuelapp npx prisma generate
sudo -u fuelapp bash -c 'set -a; . ./.env; set +a; npm run build'
sudo -u fuelapp pm2 restart fuelsystem --update-env
curl -fsS http://127.0.0.1:3300/api/health
```

**B. Database too — a migration did damage. Loses every row written since the backup.** Prisma is forward-only; the backup *is* your migration rollback.

Capture what you are about to discard **before** you overwrite the file — after the `cp` there is nothing left to query:

```bash
sqlite3 /var/lib/fuel-system/app.db \
  "SELECT id, issueDate, assetId, litres, totalCost FROM FuelIssue WHERE createdAt > '<BACKUP_TIME>' ORDER BY createdAt;" \
  > ~/rows-lost-in-rollback.txt
```

```bash
sudo -u fuelapp pm2 stop fuelsystem
sudo cp /home/fuelapp/fuel-db-backups/app.db.live.<STAMP> /var/lib/fuel-system/app.db
sudo rm -f /var/lib/fuel-system/app.db-wal /var/lib/fuel-system/app.db-shm   # NOT optional
sudo chown fuelapp:fuelapp /var/lib/fuel-system/app.db
sqlite3 /var/lib/fuel-system/app.db "PRAGMA integrity_check;"
sqlite3 /var/lib/fuel-system/app.db "SELECT COUNT(*) FROM FuelIssue; SELECT COUNT(*) FROM Bill;"
sudo -u fuelapp pm2 start fuelsystem
```

The `rm -f` of the sidecars is mandatory: those belong to the *old* database file, and SQLite replaying a stale WAL over a restored database gives you corruption rather than an error. Never roll the database back without rolling the code back too — an old schema under new code fails in ways far harder to diagnose than the bug you were escaping.

---

# Fix before real users are on this

Ordered by impact.

1. **Rotate all 12 passwords + both WorkshopOne session tokens (step 25).** The hashes are already public; bcrypt is a speed bump, and short SITE_PUMP operator passwords crack offline in minutes.
2. **Decide the git history purge.** `git rm --cached` stops *future* commits from carrying data, but all 142 historical commits that touch `data/app.db` still hand over a full database on `git clone`. A `git-filter-repo` mirror purge + force-push makes a *fresh* clone clean and nothing more — it does not reach anyone who already cloned, does not touch forks, and GitHub keeps unreachable blobs fetchable by SHA until a Support ticket runs gc. It rewrites all 342 commits across 17 refs and forces every clone (VPS included) to be re-cloned. Do it if you need to state the history is clean; do not treat it as making the leak go away.
3. **Verify the backup actually targets the live file** (step 23 check). A backup system that logs success while snapshotting the wrong file is worse than none, because you stop checking.
4. **Enable Cloudflare Authenticated Origin Pulls (mTLS).** The commented block is already in the nginx config. Without it, anyone who learns the origin IP *and* is inside an allowed range can reach the app directly.
5. **Fix the timezone-naive day bucketing** in `src/lib/assignments/overlaps.ts:25`, `src/lib/assignments.ts:59,64`, `src/lib/breakdowns.ts:52`. `TZ=Asia/Colombo` masks it today; the inconsistency with the rest of the billing code (which correctly passes `timeZone:'Asia/Colombo'`) will resurface the moment anything runs elsewhere.
6. **Move `serviceSync` writes behind the `ok` check** (`workshop-scheduler.ts:47-48`). Even with the poller disabled this is a latent 576-writes-a-day cost against a single-writer database.
7. **Add an external uptime monitor** on `https://fuelsystem.ec-workshops.online/api/health`, alerting on HTTP != 200 **or** body missing `"ok":true` (a 503 still returns JSON). Do not point it at the bare IP — the firewall will make it alert continuously. Cloudflare's own health checks are a paid feature.
8. **Remove the request logger in `src/proxy.ts:9`** or downgrade it. It logs Host, Origin and forwarded headers for every single request, filling `pm2` logs and leaking request shape into a file other apps' operators on this shared box can read.
9. **Add a health gate to `scripts/deploy-to-vps.sh`** after `pm2 start`: poll `http://127.0.0.1:3300/api/health` for 30 s and exit non-zero on failure, so the existing EXIT trap catches a broken deploy instead of leaving it up.
10. **Reduce the deploy downtime.** The current script stops the app for the entire interactive session. Splitting the one-off imports out of the update path is the cheapest win.