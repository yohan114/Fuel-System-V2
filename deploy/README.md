# Deploying to fuelsystem.ec-workshops.online

Server `20.204.51.43` · Ubuntu 22.04/24.04 · Node 24 · nginx · PM2 · Cloudflare in front

Run these in order. Every script is idempotent and re-runnable; each one checks
before it acts and stops rather than guessing.

---

## Before you start: what the DNS is actually doing

`fuelsystem.ec-workshops.online` currently resolves to **Cloudflare**
(`104.21.28.69`, `172.67.144.154`), not to `20.204.51.43`, and returns **404** —
so the record is proxied and Cloudflare has no working origin behind it.

That is fine, and arguably better than pointing straight at the box, but it
changes two things that the generic Ubuntu/Next.js guides get wrong:

- **TLS.** Cloudflare terminates HTTPS at its edge. What the origin needs is a
  certificate Cloudflare trusts, not one browsers trust. A Cloudflare Origin
  Certificate is free, lasts 15 years and needs no renewal cron.
- **Client IPs and scheme.** Every request arrives from a Cloudflare address
  over plain HTTP. Without the `real_ip` block, your logs record Cloudflare for
  every visitor; without the forwarded-proto map, the app builds `http://` URLs
  and drops `Secure` cookies — a login redirect loop that reproduces only
  through Cloudflare and never when you curl the origin directly.

In the Cloudflare dashboard for `ec-workshops.online`, confirm:

| Setting | Value |
|---|---|
| DNS → `fuelsystem` A record | `20.204.51.43`, **Proxied** (orange cloud) |
| SSL/TLS → encryption mode | **Full (strict)** once the origin cert is installed |
| SSL/TLS → Always Use HTTPS | On |

Do **not** leave the mode on *Flexible*: Cloudflare would speak HTTP to the
origin while showing visitors a padlock, and the login POST would loop.

---

## 1. Bootstrap the box

```bash
ssh <you>@20.204.51.43
curl -fsSL https://raw.githubusercontent.com/yohan114/Fuel-System-V2/main/deploy/bootstrap.sh -o bootstrap.sh
less bootstrap.sh
sudo bash bootstrap.sh
```

Installs packages, sets the timezone to Asia/Colombo, installs Node 24 and PM2,
creates the `fuelapp` user and the directories, clones `main`, generates
`.env` with fresh secrets, and builds `better-sqlite3` natively.

**It prints `SEED_ADMIN_PASSWORD` once. Copy it before you close the terminal.**

The secrets are generated *on the server* and never travel. It refuses to
overwrite an existing `.env` — regenerating `FUEL_AUTH_SECRET` invalidates every
session cookie and logs the whole company out.

**Check:** ends with `Bootstrap complete`, and `file
node_modules/better-sqlite3/build/Release/better_sqlite3.node` says
`ELF 64-bit LSB shared object` — not a Windows DLL.

---

## 2. Carry the database up

The database never travels through git. From the workstation:

```bash
cd "D:/Fuel system server side/fuelsystem"
npx tsx scripts/make-ship-db.ts          # writes data/app-ship.db + .sha256
scp data/app-ship.db <you>@20.204.51.43:/tmp/app-ship.db
```

On the server:

```bash
sudo bash /var/www/fuelsystem/deploy/install-db.sh /tmp/app-ship.db
```

It verifies the file *before* moving it into place, backs up anything already
there, and proves the app user can actually write.

**Check:** the sha256 and the four counts match what `make-ship-db.ts` printed.
Today's file: `33.1 MB`, `12 users, 770 assets, 13690 fuelIssues, 703 bills`,
sha256 `e70abb1c18d9ef6b7628eb94407aaec74bc169faf48e0e3697e0a3c982bc9a6d`.
A mismatch means re-ship — do not "fix it later".

---

## 3. Build and start

```bash
sudo bash /var/www/fuelsystem/deploy/start-app.sh
```

Checks the config, shows migration status read-only (and offers to apply with a
backup first), builds, starts under PM2, enables boot persistence, and does not
finish until `http://127.0.0.1:3300/login` returns 200.

**Check:** ends with `http://127.0.0.1:3300/login -> 200`. The app is on
loopback only at this point — nothing is public yet.

---

## 4. nginx

```bash
cd /var/www/fuelsystem
sudo bash deploy/nginx/cloudflare-realip.sh      # do this FIRST
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/fuelsystem-proxy.conf /etc/nginx/snippets/
sudo cp deploy/nginx/fuelsystem.conf /etc/nginx/sites-available/fuelsystem
sudo ln -sf /etc/nginx/sites-available/fuelsystem /etc/nginx/sites-enabled/fuelsystem
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

`cloudflare-realip.sh` must run first — the site config depends on the
`$cf_forwarded_proto` map it writes, and `nginx -t` fails without it.

**Check:** `nginx -t` says `syntax is ok` / `test is successful`, and from your
own machine `curl -I http://20.204.51.43 -H 'Host: fuelsystem.ec-workshops.online'`
returns 200 or a redirect — not 502. A 502 means nginx is up and the app is not;
check `sudo -u fuelapp pm2 logs fuelsystem`.

---

## 5. TLS on the origin

**Recommended — Cloudflare Origin Certificate.** In the dashboard:
SSL/TLS → Origin Server → Create Certificate, hostnames
`fuelsystem.ec-workshops.online` and `*.ec-workshops.online`, 15 years.

```bash
sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/fuelsystem.pem     # paste the certificate
sudo nano /etc/ssl/cloudflare/fuelsystem.key     # paste the private key
sudo chmod 600 /etc/ssl/cloudflare/fuelsystem.key
```

Then in `/etc/nginx/sites-available/fuelsystem`: uncomment the `443` server
block, comment out the `include ...fuelsystem-proxy.conf;` in the port-80 block,
and uncomment the `return 301` line above it.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Finally set Cloudflare SSL/TLS mode to **Full (strict)**.

**Alternative — Let's Encrypt**, if you want an origin certificate the public
can verify:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d fuelsystem.ec-workshops.online
```

The ACME challenge location is already in the site config and Cloudflare passes
`/.well-known/` through, so this works with the proxy left on.

**Check:** `curl -I https://fuelsystem.ec-workshops.online/login` returns 200,
and the login form actually submits. If pages load but sign-in fails, the
forwarded-proto map is wrong — that is the symptom.

---

## 6. Lock the door

```bash
sudo ufw status                 # rules are staged by bootstrap.sh
sudo ufw enable                 # only after you have confirmed SSH works
```

Because the origin IP is public, anyone who knows it can bypass Cloudflare
entirely. To prevent that, restrict 80/443 to Cloudflare only:

```bash
sudo ufw delete allow 80/tcp; sudo ufw delete allow 443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp
done
```

Also narrow SSH to your own address in the **Azure Network Security Group** —
`20.204.51.43` is an Azure VM, so the NSG sits in front of ufw and is the
control that actually matters.

---

## 7. Backups

The nightly cron route needs `CRON_SECRET` from `.env`:

```bash
sudo -u fuelapp crontab -e
```

```cron
# nightly database backup at 02:30 Colombo
30 2 * * * curl -fsS "http://127.0.0.1:3300/api/cron/backup?secret=REPLACE_WITH_CRON_SECRET" >/dev/null
# keep the Cloudflare ranges current
0 4 1 * * /usr/bin/bash /var/www/fuelsystem/deploy/nginx/cloudflare-realip.sh && systemctl reload nginx
```

Backups land in `/var/backups/fuel-system` (`BACKUP_DIR` in `.env`). They are
on the same disk as the database, so copy them off the box as well — a disk
failure takes both.

**Check it actually backed up the right file**, which was a real defect until
this deploy: `ls -l /var/backups/fuel-system` should show a file within a few MB
of 33 MB, not 4 KB.

---

## Updating later

```bash
ssh <you>@20.204.51.43
cd /var/www/fuelsystem
sudo -u fuelapp git pull
sudo bash deploy/start-app.sh
```

`start-app.sh` rebuilds and restarts. It never touches the database, so it is
safe to re-run. A `next.config.ts` change **requires** the rebuild — the allowed
origins are baked into the server bundle and a bare `pm2 restart` will not pick
them up.

---

## Still outstanding

- **The GitHub repo is public and its history holds `data/app.db`** across 143
  commits, including 12 staff bcrypt hashes. Untracking it stopped new exposure;
  it did not remove the old copies. Rotate those 12 passwords before the site
  takes real logins.
- `WORKSHOP_DB_PATH` is intentionally unset — WorkshopOne is on another host, and
  the sync polls a Windows path that does not exist here.
- Google Drive backup upload needs `GDRIVE_SA_EMAIL`, `GDRIVE_SA_PRIVATE_KEY`
  and `GDRIVE_BACKUP_FOLDER_ID`; without them the local backup still runs.
