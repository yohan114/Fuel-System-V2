# Reference summaries — NOT imported

These are monthly **"Vehicle Running Summary"** billing worksheets, kept here
for reference only. They are **not** loaded into the fuel system and are **not**
sources for `scripts/import_diesel_sheets.cjs`.

They are a different data type from the daily diesel sheets in
`../source-sheets/`: each row is a *month's* total for a vehicle — worked
days/machine-hours, distance, a monthly fuel total, the rental rate, and the
total amount Rs. — i.e. historical rental billing, not daily fuel issues.

| File | Site | Period | Vehicles |
|------|------|--------|----------|
| `Batti_ICDP_LOT02_Running_Summary.xlsx` | ICDP Batti Lot-02 | Apr 2025 – Jan 2026 | 61 |
| `Inginimitiya_Vehicle_Machinery_Summary.xlsx` | Inginimitiya | May 2025 – Apr 2026 | 12 |
| `Ruwanwella_Vehicle_Machinery_Summary.xlsx` | Ruwanwella Water Project | Oct 2025 – Mar 2026 | ~20 |

Why not imported:
- They are monthly aggregates, so turning them into fuel issues would fabricate
  daily dates.
- The Inginimitiya summary's Jan–Apr 2026 overlaps fuel already loaded from the
  daily sheet (`../source-sheets/Inginimitiya_Diesel_Details.xlsx`), so importing
  it as fuel would duplicate.
- The layout is inconsistent (shifting columns, embedded formulas, sparse fuel
  values), so automated extraction is unreliable.

Decision (owner, 2026-07-08): keep as reference only.
