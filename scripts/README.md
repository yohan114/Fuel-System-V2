# Data import pipeline

`npm run seed:all` (→ `feed_all.ts`) rebuilds the local database from the source
spreadsheets, running every step below in order. Individual steps can also be
run directly: `npx tsx scripts/<name>.ts`.

## Order and what each step needs

| # | Step | Source file(s) | Missing file behaviour |
|---|------|----------------|------------------------|
| 1 | `wipe_all_data` | — | (skipped with `SKIP_WIPE=1`; keeps the admin user + settings) |
| 2 | `import_fuel_prices` | — (hardcoded price history) | — |
| 3 | `import_machines` | `E&C Machine Rental Calculator.html` (repo) | **hard fail** — the system is meaningless without the master fleet |
| 4 | `import_fuel_cons` | `EnC_Fleet_Rate_Card_2026.xlsx` (repo) | **hard fail** — consumption rates drive billing + integrity |
| 5 | `import_site_summaries` | `UPLOADS_DIR`: GB / INGI / KB / Batti LOT-03 workbooks | skip missing files with a warning |
| 6 | `import_cep_running` | `UPLOADS_DIR`: `01_January_2026.xlsb` … `05_May_2026.xlsb` | skip missing files with a warning |
| 7 | `import_badalgama_fuel` | `UPLOADS_DIR`: Badalgama plant workbooks (Mar–May) | skip missing files with a warning |
| 8 | `import_cep_abc` | repo root: `CEP-03 A,B and C - <Month> 2026.xlsx` | skip missing files with a warning |
| 9 | `fix_pv6889` | — | — |
| 10 | `import_portable_rates` | `EnC_Fleet_Rate_Card_2026.xlsx` (repo) | hard fail |
| 11 | `import_daily_sites` | repo root: Avissawella + Marawila workbooks | skip missing files with a warning |
| 12 | `import_summary_sites` | repo root: Batti LOT-02 + Ruwanwella workbooks | skip missing files with a warning |
| 13 | `fix_hex27_39` | — | — |

**Prerequisite:** every transaction importer (5–8, 11–12) refuses to run until
`import_fuel_prices` has been loaded — that failure is intentional and hard.

**On demand (not part of `seed:all`):**

| Script | Source file | Notes |
|---|---|---|
| `import_pm_master` | `Fleet_PM_Master.xlsx` (repo) | Preventive-maintenance plans per category (powers `/service/plan/<code>`). Re-import replaces workbook tasks, keeps manually added ones. |
| `import_rate_update_2026` | `Fleet_Machinery_Rental_Price_Sheet_2026.xlsx` (repo) | Per-unit rate update: hr/day tiers (DRY→d, DRY+OP→w, WET→fw), the econ/typ/heavy consumption band in the sheet's explicit L/hr or L/km unit (powers `/analytics/consumption`), and the CPC fuel-price revisions. |
| `import_service_record_db` | `service-record-data.db` (repo) | Merges the E&C Service Record System: filter database + cross-references + prices, machine↔filter links, and the full service-job history (idempotent via sourceRef; manual records untouched). |
| `merge_duplicate_assets` | — | Duplicate-vehicle merge; dry-run by default, `--apply` to execute. |

## Moving fuel data between instances

`deploy-to-vps.sh` restores the server's own database over the repo's copy on
purpose, so operators never lose what they typed. The consequence is that fuel
imported on a workstation **does not travel with the code** — it has to be
carried as data:

```bash
# on the instance that HAS the data
npx tsx scripts/export_fuel_data.ts            # → data/fuel-data-export.json

# on the instance that NEEDS it (deploy-to-vps.sh does this for you)
npx tsx scripts/import_fuel_data.ts            # dry run: what would be added
npx tsx scripts/import_fuel_data.ts --apply
```

Direction is whichever way the data needs to go — export from the instance that
has it, import into the one that does not.

**The sync only ever adds.** That keeps it safe on a live server, but it means a
site whose fuel was *replaced* here cannot be fixed by the sync alone — the
server's superseded rows would survive and the site would double-count. Galagedara
is exactly that case, which is why `deploy-to-vps.sh` runs
`import_galagedara_stock_book` on the server *before* the sync: the importer
retires the old rows, and the sync then finds the book's rows already present and
adds nothing.

| Script | Notes |
|---|---|
| `export_fuel_data` | Dumps fuel issues, replenishment requests, meter readings, site allocations and tank stock by natural key (UUIDs do not survive across databases). Foreign keys travel as names: project code, username, price date. Also carries the referenced vehicles and tanks so the importer can rebuild a missing referent. |
| `import_fuel_data` | Replays that file into the current database. Purely additive — never edits or deletes an existing row, so operator-entered records and rows absent from the export are untouched. Idempotent: issues are reconciled by natural-key **count**, so genuine twice-in-a-day refuels survive while a re-run adds nothing. |

A pump's stock level is meaningless without the deliveries that filled it, which
is why replenishments travel with the issues rather than separately. Site
allocations travel for the same reason: they decide which site a vehicle's cost
lands on and from what date, so without them a vehicle's arrival date does not
survive the trip.

Duplicate checks compare dates **in memory**, never through a `where` filter on a
date column. This database does not store DateTime text in one single
representation, so an equality filter can miss rows that are identical — a row
can fail to find itself — and a sync relying on one would re-insert everything it
had already sent.

**Tank stock is the exception to "additive".** A balance is a single current
number, not a history, so it cannot be merged — adopting the export's figure
overwrites whatever the target has pumped since. Differences are therefore
reported and left alone unless you pass `--adopt-balances`
(`FUEL_ADOPT_BALANCES=1` for the deploy script), which you should only do when
the export is genuinely the authority on stock levels.

Vehicles missing on the target are skipped and listed rather than guessed at;
re-run with `--create-missing-assets` (or `FUEL_CREATE_ASSETS=1` for the deploy
script) to create them from the export. A category is never invented — it drives
PM schedules, so an unknown one is reported instead.

## Where files are looked up

- **Repo-root importers** read from `process.cwd()` — keep the workbooks next to
  `package.json` (they are committed for the known sites).
- **`UPLOADS_DIR` importers** read hashed upload names from one folder:

  ```bash
  UPLOADS_DIR=/path/to/fuel-data npm run seed:all
  ```

  If your copies have different names, stage symlinks that map your files to the
  expected names, e.g.:

  ```bash
  mkdir -p /tmp/uploads
  ln -s "$PWD/BADALGAMA PLANT -March -2026.xlsx" \
        "/tmp/uploads/128f30f0-BADALGAMA_PLANT_March_2026_1.xlsx"
  UPLOADS_DIR=/tmp/uploads npx tsx scripts/import_badalgama_fuel.ts
  ```

  Each script's header lists the exact file names it expects.

## Site login users

Importers create one `USER` login per site. The password is **generated
randomly on first creation and printed once** in the import output — record it
then, or reset it from the admin Users page. Re-imports never touch existing
credentials (the log prints `password unchanged`).

## Idempotency

Re-running an importer first clears only the records it owns (matched by
source/site) and then re-imports them, so `seed:all` and individual re-runs are
safe. A skipped (missing) file simply leaves that dataset absent.
