# Fuel + Service merge

This app absorbs the standalone **Service Record system** so the **Service
Planner** is backed by the same detailed service history it predicts against.
The merge shipped in four phases:

| Phase | What it added |
|---|---|
| 1 | Detailed service sheet (oils / filters / cost lines + labour & sundry), searchable history, planner reads real records. |
| 2 | Filter **cross-reference engine** + editable **price books** (auto-fill prices on the sheet). |
| 3 | File **attachments** on service records (stored inline as `Bytes`, so they ride along with DB backups). |
| 4 | **Bulk import** of the real catalog + service history, and a fleet ↔ catalog **reconciliation** report. |

All money is stored in **LKR cents**. Charge math: labour 20% of parts up to
Rs 10,000 and 15% above; sundry 5% — all editable in **Admin → Service Prices**.

## Where things live

- Engine / logic: `src/lib/service/` (`compute`, `interval`, `charge`, `master`, `pricebook`, `xref`).
- Server actions: `src/app/actions/` (`service`, `xref`, `pricebook`, `attachment`).
- Pages: `/service` (planner), `/service/new`, `/service/records`, `/service/records/[id]`,
  `/service/cross-reference`, `/admin/service-prices`.
- Attachment stream: `/api/service-attachments/[id]`.

## Production rollout

Run from the app root with `DATABASE_URL` set. The import scripts read the
Service Record repo; point `SERVICE_RECORD_DIR` at a checkout of it.

```bash
# 1. Schema
npx prisma migrate deploy

# 2. Base data: categories, admin, oil/filter master lines, charge rates,
#    oil-grade prices (idempotent — re-running keeps admin edits).
npm run seed

# 3. Filter catalog + price book + vehicle links, then build the xref index.
SERVICE_RECORD_DIR=/path/to/service-record npx tsx scripts/import_service_catalog.ts

# 4. Historical service records (dry-run first to see the match rate).
SERVICE_RECORD_DIR=/path/to/service-record npx tsx scripts/import_service_history.ts --dry-run
SERVICE_RECORD_DIR=/path/to/service-record npx tsx scripts/import_service_history.ts

# 5. Check how well the catalog's vehicle links map to the live fleet.
npx tsx scripts/reconcile_fleet_catalog.ts
```

## Scripts

- **`import_service_catalog.ts`** — upserts `FilterCatalog` by source id (manual
  cross-references survive), **replaces** the filter price book and vehicle links,
  then rebuilds the auto cross-reference index.
- **`import_service_history.ts`** — imports the `Summery` sheet of
  `Service record.xlsx`. Each row is matched to an `Asset` by E&C code or
  registration (normalized, so `LB01` matches `LB-01`); unmatched rows are
  reported and skipped. Idempotent: a row already present
  (`asset + date + job no`) is not re-imported. Historical rows carry no prices,
  so totals stay 0; new services captured in-app get the full breakdown.
- **`reconcile_fleet_catalog.ts`** — read-only. Reports how many catalog E&C
  codes match a live asset exactly, match only after normalization (cleanable),
  or not at all — i.e. how complete "machines that use this filter" will be.

## Notes & caveats

- **Re-runs are safe.** Catalog/prices/links reload; the history import skips
  duplicates; the seed preserves admin price/rate edits.
- **Cross-reference prices are estimates** found via any equivalent code in the
  price book. The source cross-reference data is sparse in places — verify before
  ordering.
- **"Machines that use this filter"** matches catalog link codes to `Asset.code`.
  Coverage depends on those codes being clean; `reconcile_fleet_catalog.ts`
  quantifies the gap.
- **Access (`VehicleFilterDB.accdb`) import is optional and Windows-only** (it
  needs `export_services.ps1` in the Service Record repo). The Excel history above
  is the supported path on Linux/CI.
- Local `.env` needs `DATABASE_URL` (e.g. `file:./data/app.db`); `data/` and
  `.env*` are git-ignored.
