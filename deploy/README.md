# Deploying onto 20.204.51.43 — a server that already runs WorkshopOne

Incumbent: **WorkshopOne**, `:1929`, owns a live SQLite database on this box.
Newcomer: **fuel system**, `:3300` on loopback, behind nginx, behind Cloudflare.

The order is **survey → decide → act**. Nothing here changes anything until you
have read what is already on the machine.

---

## 0. What the earlier "fresh box" version of this bundle would have done

Worth stating plainly, because most of it was silent:

| | |
|---|---|
| Replaced the **system Node** with 24 | WorkshopOne's compiled SQLite addon becomes ABI-mismatched. It keeps running on the loaded binary and dies at its **next restart or reboot** with "Module did not self-register" — days later, unconnected to this deploy. |
| `rm /etc/nginx/sites-enabled/default` | Very plausibly WorkshopOne's only public route. It stays up on loopback, so every process check passes while the site is dead. |
| A duplicate `map $connection_upgrade` | nginx then **refuses to start**. The running process keeps serving, so nothing looks wrong until the next reload — logrotate's, at 03:00 — and then **both** apps are down. |
| `ufw enable` | Default-denies `:1929` off the network instantly. |
| Fresh random `FUEL_PORTAL_TOKEN` | Every WorkshopOne call into `/api/portal/*` 401s. Nothing logs it on this side; its panels just stop updating. |
| Machine timezone → Asia/Colombo | Shifts every existing cron and timer on the box. |

All fixed in this bundle. The scripts bring their own Node at `/opt/node-24`,
run PM2 under their own user with their own `PM2_HOME`, and touch nothing of
the incumbent's.

---

## 1. Survey — read-only, safe on a production box any time

```bash
ssh <you>@20.204.51.43
curl -fsSL https://raw.githubusercontent.com/yohan114/Fuel-System-V2/main/deploy/survey-server.sh -o survey.sh
less survey.sh
sudo bash survey.sh
```

No package changes, no service restarts, no writes outside `/tmp`. Env files are
read **keys only** — it never prints a secret value. It tees a report to
`/tmp/fuel-survey-<timestamp>.txt` and ends with a one-screen SUMMARY.

**Send me the SUMMARY block** — the decisions below hang off it.

---

## 2. Decide, from what the survey shows

| If the survey shows | Then |
|---|---|
| `:1929` process runs on `/usr/bin/node` | Good — bootstrap installs Node privately at `/opt/node-24` and never touches the system one. Nothing to change. |
| `:3300` already in use | Bootstrap refuses to run. Pick another port and change it in `.env`, `deploy/ecosystem.config.js` (both the `args` and `env.PORT`), and both `proxy_pass` lines in `nginx/fuelsystem-proxy.conf`. |
| `sites-enabled/default` proxies to `:1929` | **Do not delete it.** Skip the catch-all; add the fuel vhost alongside it. |
| `sites-enabled/default` is the stock Ubuntu placeholder | Install `000-catchall.conf`, then the fuel vhost. |
| Something already declares `default_server` on `:80` | Skip `000-catchall.conf` — a second one stops nginx starting. |
| `$connection_upgrade` already declared | `cloudflare-realip.sh` detects this and omits its own copy. Nothing to do. |
| `ufw` is inactive | Leave it inactive. Use the Azure NSG for SSH. Enabling it is WorkshopOne's owner's call, not this deployment's. |
| WorkshopOne's hostname is **not** Cloudflare-proxied | Do **not** narrow 80/443 to Cloudflare ranges — that would cut off WorkshopOne's users too. |
| WorkshopOne's SQLite is 0600 in a 0700 directory | Use the snapshot approach in §6. Do not grant `fuelapp` into its directory. |

---

## 3. Bootstrap

```bash
curl -fsSL https://raw.githubusercontent.com/yohan114/Fuel-System-V2/main/deploy/bootstrap.sh -o bootstrap.sh
less bootstrap.sh
sudo bash bootstrap.sh
```

Asks you to type `SHARED` to confirm you surveyed the box, refuses if `:3300` is
taken or another web server owns `:80`, installs Node privately, creates
`fuelapp`, clones `main`, writes `.env`, and builds `better-sqlite3`.

**Copy the `SEED_ADMIN_PASSWORD` it prints.**

**Check:** it ends by printing the system Node as *untouched*, and
`/root/fuel-deploy-node-before.txt` records what was there before.

---

## 4. Set the shared token — before starting anything

`bootstrap.sh` deliberately writes a placeholder. This is a **shared secret**
with WorkshopOne; generating a new one on this side breaks the link.

```bash
sudo nano /var/www/fuelsystem/.env
# FUEL_PORTAL_TOKEN="<WorkshopOne's SERVICE_PLANNER_TOKEN>"
```

The survey report names the file holding it without printing its value; read it
on the box. `start-app.sh` refuses to start while the placeholder is there, and
verifies the token against `/api/portal/summary` once running.

---

## 5. Database, then start

From the workstation:

```bash
cd "D:/Fuel system server side/fuelsystem"
npx tsx scripts/make-ship-db.ts
scp data/app-ship.db <you>@20.204.51.43:/tmp/app-ship.db
```

On the server:

```bash
sudo bash /var/www/fuelsystem/deploy/install-db.sh /tmp/app-ship.db
sudo bash /var/www/fuelsystem/deploy/start-app.sh
```

Current file: `33.7 MB`, `12 users, 770 assets, 14230 fuelIssues, 704 bills`,
sha256 `16d90f6c89920463420fd4cceac99005d034fb8c12d0d4331299c7462298e922`.
It carries the **rotated** password hashes — if you shipped an earlier copy,
ship this over it.

Rebuilt 31 Aug 2026, after Galagedara. Holds the five-site August import
(362 issues), the Badalgama tank correction (726.718 L from a physical dip), and
Galagedara/CEP-03F (177 issues, 8,152 L, carrying that site to 28 Aug).
`fuelIssues` counts all rows, of which 14,220 are live and 10 voided.

**This is the last full overwrite that is safe.** Once the server has real
traffic, installing a locally-built database over it destroys whatever was
entered there. From that point the SERVER is the master: change data on the
server, and take copies downward, never upward.

`start-app.sh` runs it under **PM2 as `fuelapp` with `PM2_HOME=/home/fuelapp/.pm2`**.
That isolation is the whole safety story: `pm2 save` overwrites `dump.pm2` rather
than merging, so under a home shared with WorkshopOne every fuel deploy would
rewrite its boot list. The script checks no other daemon shares that home and
refuses if one does. It finishes by checking `:3300` answers, that the portal
token is accepted, **and that WorkshopOne on `:1929` is still up.**

---

## 6. Wire the service sync to WorkshopOne

The fuel system reads WorkshopOne's service jobs directly. Do **not** point it
at the live file: `better-sqlite3`'s `readonly: true` on a WAL database still
has to map the `-shm` sidecar, which needs *write* permission on that file and
its directory. `chmod 444` on the `.db` looks right and fails.

Take a consistent snapshot instead — as WorkshopOne's own user, so no permission
grant into its directory is needed:

```bash
sudo -u <workshopone-user> crontab -e
```

```cron
# every 5 minutes, a consistent copy for the fuel system's service sync
*/5 * * * * sqlite3 /path/to/workshopone.db ".backup '/var/lib/fuel-system/workshopone-snapshot.db'" && chown fuelapp:fuelapp /var/lib/fuel-system/workshopone-snapshot.db
```

Then uncomment in `/var/www/fuelsystem/.env`:

```
WORKSHOP_DB_PATH=/var/lib/fuel-system/workshopone-snapshot.db
```

`.backup` is safe against a concurrent writer and folds in the WAL, so the
snapshot is never torn. Restart with:

```bash
sudo -u fuelapp PM2_HOME=/home/fuelapp/.pm2 /opt/node-24/bin/npx pm2 restart fuelsystem --update-env
```

**Check:** `serviceSync.lastResult` on the admin screen shows `ok: true` with a
non-zero `scanned`. Locally it reads 1,650 jobs. Leaving `WORKSHOP_DB_PATH`
unset is safe — the sync stays idle; pointing it at a path that does not exist
is not, it fails every 5 minutes forever.

---

## 7. nginx

```bash
cd /var/www/fuelsystem
sudo bash deploy/nginx/cloudflare-realip.sh      # FIRST — and it now rolls back on failure
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/fuelsystem-proxy.conf /etc/nginx/snippets/
# only if the survey said no default_server exists:
sudo cp deploy/nginx/000-catchall.conf /etc/nginx/sites-available/000-catchall
sudo ln -sf /etc/nginx/sites-available/000-catchall /etc/nginx/sites-enabled/000-catchall
sudo cp deploy/nginx/fuelsystem.conf /etc/nginx/sites-available/fuelsystem
sudo ln -sf /etc/nginx/sites-available/fuelsystem /etc/nginx/sites-enabled/fuelsystem
sudo nginx -t && sudo systemctl reload nginx
```

**Check both apps, by Host header, before and after:**

```bash
curl -sI http://127.0.0.1 -H 'Host: fuelsystem.ec-workshops.online' | head -1
curl -sI http://127.0.0.1 -H 'Host: <workshopone-hostname>'          | head -1
curl -sI http://127.0.0.1                                            | head -1   # unmatched Host
```

`nginx -t` validates syntax. It does **not** tell you which block wins for a
given Host — only these curls do.

---

## 8. Cloudflare and TLS

The DNS is proxied through Cloudflare (`104.21.28.69`, `172.67.144.154`) and
currently 404s. In the dashboard for `ec-workshops.online`:

| Setting | Value |
|---|---|
| DNS → `fuelsystem` A record | `20.204.51.43`, **Proxied** |
| SSL/TLS mode | **Full (strict)** once the origin cert is installed |
| Always Use HTTPS | On |

Cloudflare terminates TLS and speaks plain HTTP to the origin, so `$scheme` is
`http` even for an HTTPS visitor. Pass that through and the app builds `http://`
URLs and drops `Secure` cookies — a login redirect loop that reproduces *only*
through Cloudflare, never when you curl the origin. `cloudflare-realip.sh`
handles it.

Origin certificate — a Cloudflare Origin Certificate is free, lasts 15 years and
needs no renewal cron:

```bash
sudo mkdir -p /etc/ssl/cloudflare && sudo chmod 700 /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/fuelsystem.pem
sudo nano /etc/ssl/cloudflare/fuelsystem.key
sudo chmod 600 /etc/ssl/cloudflare/fuelsystem.key
```

Then uncomment the `443` block in the site file, comment the port-80 `include`,
uncomment the `return 301`, and reload.

---

## 9. Backups

```bash
sudo -u fuelapp crontab -e
```

```cron
30 2 * * * curl -fsS "http://127.0.0.1:3300/api/cron/backup?secret=<CRON_SECRET>" >/dev/null
0 4 1 * * /usr/bin/bash /var/www/fuelsystem/deploy/nginx/cloudflare-realip.sh && systemctl reload nginx
```

**Check the size**, which was a real defect until this deploy: a backup in
`/var/backups/fuel-system` should be within a few MB of 33 MB, not 4 KB.
Copy them off the box — they sit on the same disk as the database.

---

## Updating later

```bash
cd /var/www/fuelsystem && sudo -u fuelapp git pull && sudo bash deploy/start-app.sh
```

Rebuilds and restarts; never touches the database. A `next.config.ts` change
**requires** the rebuild — allowed origins are baked into the server bundle.

---

## What must not be done on this box

| | Consequence |
|---|---|
| `apt-get install nodejs` / NodeSource | Replaces `/usr/bin/node`; WorkshopOne dies at its next restart. |
| `rm /etc/nginx/sites-enabled/default` | May remove WorkshopOne's only public route. |
| `ufw enable`, or narrowing 80/443 | Cuts off `:1929` and any non-Cloudflare client of either app. |
| `pm2 save` as root, or without `PM2_HOME` set | Lands in a shared home and overwrites the boot list; WorkshopOne may not come back from a reboot. Always `sudo -u fuelapp PM2_HOME=/home/fuelapp/.pm2`. |
| `timedatectl set-timezone` | Shifts every existing cron and timer. |
| Pointing `WORKSHOP_DB_PATH` at the live database | `-shm` cannot be mapped read-only; fails every 5 minutes. |
| Regenerating `FUEL_PORTAL_TOKEN` alone | Silent 401s on every WorkshopOne call. |

---

## Still outstanding

- The GitHub repo is public and its history holds `data/app.db` across 143
  commits. All 12 staff passwords have been rotated, so those hashes are now
  worthless — but anyone who cloned earlier still holds them.
- The `test` account (SITE_PUMP, site TEST) is active. Consider deactivating it.
- Google Drive backup upload needs `GDRIVE_SA_EMAIL`, `GDRIVE_SA_PRIVATE_KEY`
  and `GDRIVE_BACKUP_FOLDER_ID`; without them the local backup still runs.
