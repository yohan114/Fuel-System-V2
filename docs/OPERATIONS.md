# Operations — scheduled jobs

Three cron endpoints keep the system current. Each is authorized with the
`CRON_SECRET` environment variable (send it as `?secret=` or the
`x-cron-secret` header) and is safe to re-run — every job is idempotent.

Add to the server's crontab (adjust host):

```cron
# 03:00 — daily database backup (local backups/ + Google Drive)
0 3 * * *  curl -s "https://<host>/api/cron/backup?secret=$CRON_SECRET"

# 06:00 — daily Ceypetco fuel-price sync (ceypetco.gov.lk/historical-prices)
0 6 * * *  curl -s "https://<host>/api/cron/fuel-prices?secret=$CRON_SECRET"

# 03:00 on the 1st — generate last month's bills (existing)
0 3 1 * *  curl -s "https://<host>/api/cron/billing?secret=$CRON_SECRET"
```

## Ceypetco price sync

`GET /api/cron/fuel-prices` fetches the published price table and stores one
`FuelPrice` row per product (source `CEYPETCO`) keyed on the revision's
effective date: Petrol 92 / Petrol 95 / Lanka Auto Diesel / Lanka Super Diesel
/ Kerosene. Fuel issues automatically price from the newest row on/before the
issue date (`getPriceForDate`), so a price revision applies from its effective
day without touching old issues. Manual overrides on Admin → Prices still work
and win for their date. A revision already stored is skipped, so running the
job daily is harmless.

If Ceypetco changes the page layout the job fails loudly ("no price table
recognised") rather than storing junk — check Admin → Audit for the last
successful sync.

## Google Drive backups

`GET /api/cron/backup` snapshots `data/app.db` with the SQLite online-backup
API (consistent even mid-write), gzips it, always keeps a copy in `backups/`,
and — when a service account is configured — uploads it to the Drive folder
and prunes Drive copies older than 30 days (`?keepDays=` to override).

One-time Google setup:

1. In Google Cloud console create a project (or reuse one), enable the
   **Google Drive API**, create a **service account**, and add a JSON key.
2. Share the backup folder
   (https://drive.google.com/drive/folders/1TDy_VDTQrkjyv1ib0ACZa7pweH7CZIBo)
   with the service account's e-mail address (`…@…iam.gserviceaccount.com`)
   as **Editor**.
3. Set environment variables from the JSON key:

```env
GDRIVE_SA_EMAIL="backup-bot@your-project.iam.gserviceaccount.com"
GDRIVE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
# optional — defaults to the folder above
GDRIVE_BACKUP_FOLDER_ID="1TDy_VDTQrkjyv1ib0ACZa7pweH7CZIBo"
```

Manual run any time: `npx tsx scripts/backup_drive.ts`. Without the service
account configured the job still succeeds as a local-only backup.

To restore: download a `fuel-backup-….db.gz`, `gunzip` it, stop the app, and
replace `data/app.db` with the extracted file.
