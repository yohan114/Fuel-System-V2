# Oil Stock Book merge

This app absorbs the standalone **Oil Stock Book** so oil, lubricant and
consumable stock is tracked against the **same fleet, projects and people** this
system already uses for fuel, service and billing. Rather than running a second
app behind a proxy, the Oil Stock Book domain is ported into this Next.js /
Prisma stack and its issues link directly to canonical `Asset` and `Project`
rows — so a machine's oil consumption sits alongside its fuel and service cost,
powering complete per-machine total cost of ownership.

The merge shipped in phases (all delivered):

| Phase | What it adds | Status |
|---|---|---|
| **1** | **Foundations** — data model (`Product`, `StockMovement`, `Site`, `StockCount`, `Requisition`, `Battery`/`BatteryEvent`, `ConsumerAlias`), the running-balance ledger, the `STOREKEEPER` role, and the importer (Excel seed + live-DB migration). | ✅ |
| **2** | **Core stock book** — `/store` ledger, product catalog, receipts/issues with the over-issue guard, consumer **Mapping** screen, month-end **stock-take**. | ✅ |
| **3** | **The payoff** — service sheets auto-draw oil stock; complete per-machine **TCO** on `/reports/tco` (fuel + service + oil). | ✅ |
| **4** | **Requisitions** (request → approve → send → receive) + **Battery register** (inline photos, append-only audit) + **unified `/alerts`** (low stock, overdue stock-take, pending requisitions). | ✅ |

All money is stored in **LKR cents** (Oil Stock Book stored rupees; prices are
converted on migration). Filters keep their existing dedicated engine
(`FilterStock` / `FilterStockMovement` / `FilterPurchaseOrder`); this
`Product` / `StockMovement` ledger covers oils, lubricants, greases, spares,
tyres and other consumables. A later phase may fold filters into the unified
model.

## Where things live

- Schema: the new models in `prisma/schema.prisma` (after `ServiceAttachment`),
  migration `prisma/migrations/20260622030833_oil_stock_foundation`.
- Logic: `src/lib/stock/` — `classify` (normalise / date parsing / consumer
  classification + product & project maps) and `ledger` (running-balance
  recompute, current balance, bulk balances).
- Roles: `STOREKEEPER` added to `src/lib/rbac.ts` (create / update / approve /
  manage — no hard-delete, no fuel allocation).
- Importer: `scripts/import_oil_stock.ts` (`npm run seed:oil`).

## Importing the data

Run **after** the fleet/projects have been seeded (`prisma db seed`), so oil
issues can link to the fleet.

```bash
# Fresh seed from the source stock book (idempotent — re-runs never duplicate)
npm run seed:oil -- data/source/stockbook.xlsx
npm run seed:oil -- --fresh data/source/stockbook.xlsx   # wipe inventory first

# Migrate a running Oil Stock Book database, then reconcile to the book
npm run seed:oil -- --from-db /path/to/oilbook.db
```

In `--from-db` mode the live database is the source of truth (it already holds
the Excel-seeded rows plus manual entries, batteries, requisitions and
stock-takes); the Excel "Summery" sheet is then used only to **cross-check**
balances, never re-inserted — so nothing is double-counted. Integer ids are
remapped to UUIDs and consumers are relinked to this system's `Asset`/`Project`.
Battery photos move from disk into inline `Bytes` (like `FuelIssue.photoData`),
so they ride along with DB backups.

## Data fidelity

The importer treats the spreadsheet's **Balance** column as authoritative:
opening balances and stock-take adjustments are captured as movements so the
recomputed running balance reproduces the book exactly. On a fresh import of the
source stock book, the computed balance matches the original **"Summery"
snapshot for all 18 listed products, to the unit**. Out-of-range dates are
tolerated (flagged in `remark`, never dropped). Issues whose consumer can't be
matched are recorded as unresolved `ConsumerAlias` rows for the Mapping screen.

## Consumer linking

Each issue is classified, in priority order: a resolved alias → a whole-string
or per-token match against `Asset.code` / `Asset.regNo` → a project pattern →
an internal/workshop pattern → unknown. Product and project name maps live in
`src/lib/stock/classify.ts` (`PRODUCT_MAP`, `PROJECTS`).
