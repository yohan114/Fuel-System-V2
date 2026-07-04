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
