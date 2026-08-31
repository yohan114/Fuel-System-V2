# Fuel Import Plan — August 2026 Site Workbooks
*Compiled 2026-08-30 from seven analyst passes over fourteen site folders. All source inspection was read-only; nothing has been written to `data/app.db`.*

---

## 1. The headline

**890 refuel events — 21,976 litres — across 11 of the 14 site folders, spanning 2026-08-10 to 2026-08-28.** Three folders (Avissawella, Karthiu/Karaitivu, Pallamoya/Pallanoya) contain zero new fuel: their workbooks are already loaded in full and re-running their importers would double-charge those clients by 6,438 L, 13,120 L and 1,385 L respectively. Those 890 events come from 847 sheet lines (Lot 2 splits 43 of its lines into two fills each) and are **not** the same as the raw "rows after the high-water mark" that the folder-level analysis reports: 1,006 raw post-high-water rows shrink to 890 once cross-site contamination is stripped out — 18 rows / 896 L in E Package's workbook are Galagedara's 23 Aug page, 21 rows / 947 L in Ruwanwella's are Galagedara's 11 Aug page, and 5 rows / 85 L in Wadakada's are Muttur Plant's. Every project mapping is **certain** — no folder is ambiguous about which site it belongs to. But only 5 of the 11 producing sites are safe to import as they stand, the largest single site (Galagedara, 8,248 L, 38% of the total) is blocked on a shared-source duplicate with E Package, and none of this makes August a complete month: LOT-04 alone can prove 2,143 L was dispensed and never transcribed. **August 2026 still must not be invoiced after this import.**

---

## 2. The sites

| Site folder | Project | New rows | New litres | Date range | Confidence | Blockers |
|---|---|---:|---:|---|---|---|
| `Galagedara` | CEP-03F | 182 | 8,248 | 13–28 Aug | Count **high**, import-safety **low** | Shares 23 Aug page with E Package; importer column drift (r[5]→r[7]); 3 broken meter chains; 3 unmatched codes; 10 per-day tabs duplicate all 182 rows with inconsistent header offsets |
| `Lot 2` | BATTI-02 | 233 events (190 lines) | 3,573 | 13–28 Aug | Count **high**, safety **medium** | 9 unmatched codes, 3 genuinely ambiguous; no importer fits; pre-existing 95 L over-charge on 1–3 Aug |
| `LOT-03 ICDP` | BATTI-03 | 110 | 2,113 | 13–27 Aug | Count **high**, safety **low** | **Every date in the workbook says 2025.** As written, 0 rows import and 209 rows land in a closed 2025 |
| `LOT-04` | IRD-04 | 78 | 2,003 | 13–22 Aug | Count **high**, safety **low** | 13 Aug is half-imported (6 of 19 rows); column D is a tank totaliser, not a meter; 2,143 L dispensed but never transcribed |
| `LOT 3 Sameera` | IRD-03 | 77 | 1,675 | 13–26 Aug | Count **high**, safety **medium** | 4 unmatched codes (one is a column-swap artefact, not a machine); no importer; 6 meter regressions |
| `E Package` | CEP-03E | 49 | 1,275 | 12–23 Aug | Count **medium**, safety **low** | 18 of its 67 post-high-water rows are Galagedara's; pre-existing 310 L duplicate block on 2–6 Aug; `MS-18` alias; `LD-1709` letter error; SR-18 meter break |
| `Ruwanwella` | RUWA | 87 | 1,180 | **10**–18 Aug | Count **medium**, safety **low** | 21 rows / 947 L in the file are CEP-03F's and already in the DB; 5 rows / 55 L sit *on* the boundary date; 1 in-range exact duplicate; no importer exists |
| `Inginimitiya` | ING | 27 | 824 | 11–22 Aug | Count **high**, safety **medium** | Repeated petrol header block (3,968 L of phantom litres if walked to end-of-sheet); daily tabs restate the same 824 L; 5 code-format mismatches |
| `LOT-05` | MANN | 31 | 595 | 14–23 Aug | Count **high**, safety **high** | Tank goes to −595 L; one copy-paste meter; `(1st)/(2nd)` is the only marker for 3 legitimate double-fills |
| `Wadakada` | CEP-03W | 14 | 470 | 27–28 Aug | Count **high**, safety **low** | 200 L of the 470 is an inter-site transfer, not a machine; pre-existing ~295 L double-charge; 5 unmatched codes; truncated meters |
| `Muthu ( MR Thilanka)` | MUTUR | 2 | 20 | 13–14 Aug | Count **high**, safety **high** | Both rows also appear in the Wadakada workbook — import from one file only |
| `Avissawella` | AWIISAWELLA | 0 | 0 | — | **Certain** | Nothing to import. Workbook ends on the high-water date |
| `Karthiu Bridge` | KARA | 0 | 0 | — | **Certain** | Nothing to import. Byte-identical to the loaded copy |
| `Pallamoya Bridge` | PALO | 0 | 0 | — | **Certain** | Nothing to import. Existing 260 L double-charge needs voiding |
| **Total** | **11 sites** | **890** | **21,976** | **10–28 Aug** | | |

*Every project code above is **certain**, established from workbook contents (banner text, project codes on receipt rows, existing DB source strings), not folder names. The "Karthiu Bridge" folder is a misspelling of Karaitivu; "LOT 3 Sameera" is I-Road Lot-03 (IRD-03), not ICDP Batti Lot-03 (BATTI-03) — those two are easy to confuse and are different clients.*

---

## 3. Sites that are NOT safe to import yet

Six sites are blocked. Two more are blocked on a *shared* defect and must be decided together.

### 3.1 E Package (CEP-03E) + Galagedara (CEP-03F) — blocked jointly
**This is the single most expensive error available in this import.** Both folders hold the byte-identical source photo `WhatsApp Image 2026-08-24 at 08.03.09.jpeg` (md5 `714265f0f0479c121ac5767952d3f018`) and both transcribed it. E Package's `23-08-2026` sheet has 22 rows / 1,006 L, but lines 1–18 (896 L) are a second, worse transcription of Galagedara's 23 Aug page. Sixteen match to the litre; two differ only by transcription error (`LO-4925` 20 L vs 30 L; `LN-8297` vs `LN-8277`; `DAG-4969` meter 15033.5 vs 150335, a misplaced decimal).

**Decision required:** import those 18 rows under **CEP-03F only**, using Galagedara's transcription (it is demonstrably the better one — correct plate spellings, correct meter magnitude). E Package keeps only lines 19–22 (110 L, officer Chamara). Import both folders as-is and 896 L is billed to two clients and drawn from two tanks.

Additionally unresolved on **CEP-03E**:
- `MS-18` (8 rows, 325 L) is a hand-made alias for `MG-18`. A prior import created that alias by hand; no generic matcher will reproduce it. **Needs an explicit alias entry.**
- `LD-1709` → `LP-1709` (DT-78). A letter substitution, not a digit — the one-digit-out resolver *throws* on it.
- `2D-4605` is Galagedara's `ZB-4606` and does not belong to CEP-03E at all.
- SR-18's meter jumps 2,009 hours in three days (987 → 2998 → 3003). Those readings must be dropped, not stored.
- 10 rows / 310 L on 2–6 Aug are **already duplicated in the DB**. Pre-existing, but it means a delete-and-reload of August is not equivalent to an append.
- Two files, `EC_Daily_Fuel_Issue_Analysis_Aug2026.xlsx` and `Fuel_Issue_Summary_Aug2026.xlsx`, are **byte-identical**. Import one.

Additionally unresolved on **CEP-03F**:
- `import_galagedara_monthly.ts` has drifted: it reads `r[5]` as the Source Record string, but two meter columns were inserted there and Source moved to `r[7]`. It would stamp every row with a source like `"7539.7"`, drop all 267 meter readings, and find zero allocations (the allocation reader filters on `r[2] > 40000`, and that column is now an uncached formula reading blank). **It is also a REPLACE load — re-running it rewrites May–August.**
- Three broken meter chains in the new rows will fail any monotonicity check: `PJ-6376` (13 Aug reads 320508, a typo for 310508, making 20 Aug run backwards), `MG-07` (19 Aug 10863 → 20 Aug 10861.8), `PE-3723` (two incompatible series).
- Unmatched: `DAI-9757` (2 rows), `DAT-9762` (1 row), `LA-4225` (2 rows, one digit from `LA-4229` — but that regNo belongs to **two** assets, DT-52 and WB-05, so it is a coin toss).
- Four days in the *already-imported* window do not reconcile to the DB (25, 27, 28 Jul and 5 Aug). The workbook and the pump have already diverged.
- The entire workbook is formulas with empty cached values. **Never read a total from it — sum the rows.**

### 3.2 Wadakada (CEP-03W) — blocked
- **The file contains three sites' fuel.** Every sheet is titled "CEP/3 WADAKADA & MUTTUR PLANT". 5 rows / 85 L (13–14 Aug) are Muttur's, and 200 L on 27 Aug is an inter-site transfer to Package E.
- **`Transfer Package-E` (200 L) is 43% of the genuinely-new litres and is not a machine.** The system models transfers as `SITE-*` pseudo assets (SITE-BGP, SITE-WCP, SITE-MRS…) but no `SITE-CEP03E` / `SITE-PKGE` exists. A naive import invents a machine called "Transfer Package-E" and bills Wadakada 200 L that belongs to Package E. **Needs a pseudo-asset created and a decision on which tank it debits.**
- `LO-7183` vs `LP-7183`: both exist in the fleet as separate assets with continuously interleaving meters. They are almost certainly one truck registered twice. Accepting the workbook's normalisation silently picks a winner and moves 30 L plus meter history.
- `LP-1976` (35 L) has no fleet match and no corroborating meter. `LM-5219` is the transcriber's guess at `LM-5719`. **Do not fold either in.**
- `ZB-1496` matches PC-02, but PC-02's open AssetAssignment is to **ING** from 2026-07-22.
- ~295 L is **already double-charged** to CEP-03W across three overlapping transcriptions of 1–12 Aug (105 DB rows vs the workbook's 96 for the same days; GE-01 booked twice on 7 Aug at 120 L and 150 L).
- `--set-stock` is unsafe: the reconciliation sheet breaks twice (+380 L on 10 Aug, −25 L between 14 and 27 Aug).
- Two truncated meters (LD-09 reads 105.1 against 20060.8 three weeks earlier) are marked "Low confidence — do not use for costing until verified".

### 3.3 LOT-03 ICDP (BATTI-03) — blocked on a single, fixable fact
**Every date in the workbook reads 2025; the data is August 2026.** Evidence is conclusive: the 01–12 Aug block matches the DB's BATTI-03 rows row-for-row and litre-for-litre on all twelve days; the source photos are `WhatsApp Image 2026-08-11` through `2026-08-28`; DAF-7530's meter runs continuously with the DB's 2026 readings. Imported as written, all 209 rows land in a **closed August 2025**, miss the August 2026 bill entirely, and corrupt 2025 history.

The `_backup/..._before_year_normalise.xlsx` also carries 2025, so the earlier normalise pass never addressed this, and `generate_excel.py` hardcodes the 2025 strings. **This needs an explicit, documented year override in the importer config — I am not going to silently rewrite dates, and I would rather not edit the client's workbook.** Otherwise clean: only 2 unmatched codes (`5L-18` → SL-18, a digit-5-for-S typo; `Bolero` → almost certainly DAF-7530, whose meter brackets the reading exactly).

### 3.4 LOT-04 (IRD-04) — blocked
- **2026-08-13 is half-imported.** The DB holds the first 6 rows of that day (110 L); the workbook has 19 (490 L). A `> 08-13` filter leaves 380 L unbilled; a `>= 08-13` filter double-charges 110 L. Neither is right. The real remainder is 78 rows / 2,003 L and requires row-level, not date-level, dedupe.
- **Column D is the tank's cumulative litre totaliser, not a machine meter** (283 of 285 steps equal that row's own litres). Importing it as a meter is precisely the defect `scripts/clean-lot04-totaliser.ts` was written to undo — it notes RG-3187 ended up billed 744 hours for a 31-day August. **The meter column must not be imported at all for this site.**
- 2,143 L is missing from the register: the totaliser jumps 2,093 L between 16 and 22 Aug, matching the 17–21 Aug date gap and a missing ledger sheet 3610. **This workbook is not a complete August.**
- `MQ 17` and `MG 17` are the same grader, already split across two asset records by the previous import. Importing more widens the split. `RQ 3187` needs the `RG-3187` alias the previous import used. `MQ 12` → `MG-12`. `LO 8955` and `ZB 2533` have no plausible match.

### 3.5 Ruwanwella (RUWA) — blocked
- **21 of the 103 post-high-water rows (947 L) are a Galagedara register page**, all dated 11 Aug, all tagged `ECP 03 - 2 F`, all from `8-11.jpeg`. They are already in the DB under CEP-03F. Importing them under RUWA double-charges Galagedara and understates the Ruwanwella tank by 947 L. Genuine new = 82 rows / 1,125 L.
- **5 rows / 55 L dated exactly 2026-08-10 are in the workbook but missing from the DB** (they came from a photo that arrived on 20 Aug). A strict `> high-water` filter drops them permanently. Correct remainder is 87 rows / 1,180 L.
- One exact duplicate inside the new range (18 Aug, `Hex-0028`, 25 L, rows 218/222) — genuine second refuel or transcription repeat, undecided.
- Meters are the literal text `N/A` on 221 of 240 rows; the only 19 numeric meters are all inside the misfiled CEP-03F block. **Every genuine new Ruwanwella row has no meter at all.**
- No importer in the repo reads this flat ledger, and the ad-hoc script that wrote the existing 111 rows (source `Ruwanwella diesel log (Jul-Aug 2026)`) **is not checked in** — including the `Hex - 0036` → `HEX-36` zero-pad normalisation, which will be needed again.

### 3.6 A cross-report finding that resolves a flagged conflict — Muttur
The Wadakada analyst flagged a "genuine conflict that has to be resolved by hand": on 13 Aug the Wadakada workbook says `LD-07` 10 L meter 10297.3, while the DB says `SC-15` 10 L meter 374567. The Muttur analyst independently found the DB is **missing one row** on that same date — `LD-07`, 10 L, meter 10297.3.

**It is not a conflict.** Both machines drew 10 L on 13 Aug. The Wadakada transcription omitted SC-15; the DB omitted LD-07. Muttur's own log has all five rows and is the more complete document.

**Consequence:** MUTUR's genuine new set is 2 rows / 20 L, both LD-07 (13 Aug and 14 Aug), and both appear in *both* workbooks. Import them from the Muttur log only, and drop all Muttur-flagged rows from the Wadakada import. No hand resolution needed.

### 3.7 Zero-row sites — nothing to import, but two carry defects
- **Avissawella**: 155 rows / 6,437.85 L already in the DB, matching row-for-row. But the DB's 169 AWIISAWELLA issues include 14 rows / 765 L from *two other sources*, so the workbook is **not** a superset — a replace-in-date-range import would delete them. Also note the two apparent duplicate rows (23 Mar and 26 Apr, `31-0724`, 20 L each) are **genuine same-day repeat draws** confirmed by distinct running balances in the Full Stock Ledger; a `(date, machine, litres)` dedupe would silently drop 40 L of real fuel.
- **Karaitivu (KARA)**: reconciles cleanly (362 DB rows = 360 book + 2 legitimate consolidated-register rows; tank 340 L = the book's closing figure). `import_stock_book.ts` **deletes everything in the book's date window before inserting**, so re-running it would silently destroy those 2 register rows for no gain.
- **Pallanoya (PALO)**: **already double-charged by 260 L.** Five exact duplicates were written 13 seconds after the genuine batch on 2026-08-07, with no linked MeterReading, in the same write as a CEP-03E consolidated-register run — but stamped with source `"Pallanoya diesel stock book"`, so they are invisible to source-based reconciliation. Identifiable by `createdAt LIKE '2026-08-07T11:36:27%' AND meterReadingRecordId IS NULL`. The tank side (23 receipts, 0 L balance) agrees with the book, so tank and issue arithmetic currently disagree by exactly 260 L.

---

## 4. The import approach

### Recommendation: **one core importer + two format front-ends + a per-site profile registry.** Not eleven scripts. Not one universal script either.

**What the existing scripts show.** I read `import_cep03e_aug_register.ts`, `import_lot02_aug_sheet.ts`, `import_stock_book.ts`, and the headers of `import_cep03w_aug_register.ts` and `import_galagedara_monthly.ts`. They differ in only four places — data sheet name, header row + column indices, date encoding, and per-site alias/exclusion rules. Everything downstream is byte-for-byte the same idea, written out four separate times:

- resolve asset by `alnum(code)` then `alnum(regNo)`, then one-digit-out with a *single-candidate* guard;
- `colombo(day) = new Date(day + "T00:00:00+05:30")`, `dayOf()` via `en-CA` in `Asia/Colombo`;
- price by Colombo day from `FuelPrice` (`priceOn`), snapshot `pricePerLitre` + `totalCost` in cents;
- create `FuelIssue`, optionally create a linked `MeterReading` and back-fill `meterReadingRecordId` in one transaction;
- meter-monotonicity guard *before* any write;
- visitor-safe assignment handling (never re-site a machine posted elsewhere);
- dry-run by default, `--apply`, stock change behind a separate flag.

That duplication is exactly why the copies have drifted apart: `import_stock_book.ts` deletes-then-inserts, `import_cep03e_aug_register.ts` appends; `import_cep03e_extra.cjs` dedupes on `day|code|litres` (which destroys the two 20 L RS-0483 fills on 15 Aug and the two 30 L ZB-4606 fills on 21 Aug) while `import_cep03e_aug_register.ts` dedupes on `(day, asset)` count (which preserves them). Writing eleven more bespoke scripts guarantees eleven more drifts, and six of the loads already in the DB were done by scripts that **are not checked in at all** — `Lot-02 fuel issuing sheet (Aug 2026)`, `ICDP Lot-03 daily fuel issuing sheet (Aug 2026)`, `EP I-Road Lot-03 daily diesel issue report (Aug 2026)`, `LOT-05 daily fuel issuing sheet (Aug 2026)`, `Ruwanwella diesel log (Jul-Aug 2026)`, `Inginimitiya monthly fuel report (Jan-Aug 2026)`. That is unreproducible history, and it is how the alias knowledge (`Hex-0036`→`HEX-36`, `MS-18`→`MG-18`, `RQ 3187`→`RG-3187`) got lost.

**Structure.**

```
scripts/import_site_fuel.ts          # the core: resolve, price, dedupe, write, report
scripts/fuel-import/readers/long.ts  # one row = one (or two) issues
scripts/fuel-import/readers/grid.ts  # day-column matrix
scripts/fuel-import/sites.ts         # the per-site profile registry
```

Two front-ends, because two shapes genuinely cannot share a reader:
- **long** — Avissawella, Wadakada, E Package, Galagedara, Ruwanwella, Lot 2, LOT-03, LOT 3 Sameera, LOT-04, LOT-05, Muttur, and both stock books. Config: `sheet`, `headerMatch` (locate by the word "Date", **never by fixed offset** — LOT-03's header is on row 3 with a genuinely blank row 2, and a `.slice(3)` silently eats the first row of every sheet), `cols`, `dateFormat` (`serial` | `dd/mm/yyyy` | `dd-mm-yyyy` | `yyyy-mm-dd` | `yyyy.mm.dd`), `rowFilter`.
- **grid** — Inginimitiya, and Wadakada's June/July book. A day-column matrix with subtotal, receipt and balance rows *inside* the data block, plus Inginimitiya's repeated petrol header. This cannot be squeezed into the long reader without the config becoming a program. `import_diesel_sheets.cjs` / `import_daily_sites.ts` already implement it; port that logic in and fix the two known bugs (the repeated `1..31` header row worth 496 phantom litres per sheet, and the skip-regex that misses `Transfer CEP-03 2F` / `Transfer Package E`).

Per-site profile carries only what genuinely differs: `project`, `tank`, `file`, `sheet`, `source` string, `aliases`, `excludeRows` (predicate — this is where Wadakada's Muttur rows, E Package's 18 Galagedara rows and Ruwanwella's 21 CEP-03F rows are dropped, *declaratively and reviewably*), `untrustedMeters`, `ignoreMeterColumn: true` (LOT-04), `dateYearOverride: 2026` (LOT-03), `expandFills: true` (Lot 2), `dateFloor` / `dateCeiling`.

**Non-negotiable core rules:**
1. **Read exactly one view per workbook.** Every single workbook here duplicates its data across per-day tabs. The profile names one sheet; the core never walks `wb.SheetNames`. This one rule prevents nine separate double-counts.
2. **Append-only. Never delete.** `import_stock_book.ts` and `import_galagedara_monthly.ts` delete-in-window-then-insert. That pattern would destroy KARA's 2 register rows and Avissawella's 14 non-stock-book rows. Removing a wrong row is a `FuelIssueCorrection` with evidence, not a silent delete.
3. **No auto-registration of assets.** Karaitivu's fleet contains an ACTIVE, OWNED asset named `LH Piyasena Piling` — a subcontractor's name that an importer auto-created. The core must **refuse** an unmatched code and print it, never invent it. Unmatched codes go in the profile's alias table or the run doesn't proceed.
4. **Receipts are not issues.** Muttur's 2 `Received` rows (1,200 L), Ruwanwella's 21 (2,635 L), Avissawella's 52, Inginimitiya's `Daily Fuel Purchase` footer rows and both stock books' `Received Qty` column all sit in the same table as the issues. A type/column check is mandatory, not optional.
5. **Meter guard before any write**, as `import_cep03e_aug_register.ts` already does — and it must run *after* dedupe, so an already-imported row is never checked against itself.

### Idempotency — how re-running is made safe

**This is the part that currently has no durable answer, and it needs a decision.**

`FuelIssue` has **no natural key and no external-reference column** (`id` is a UUID, `source` is free-text). Today's best guard, in `import_cep03e_aug_register.ts`, is a **count per `(Colombo day, assetId)` within the workbook's date window**: count what the tank already holds per key, count what the sheet emits, skip the first *n* matches. That is genuinely well-chosen and I want to keep it, because:
- it preserves same-day repeat fills, which are real and common (Galagedara ZB-4606 twice at 30 L on 21 Aug with distinct meters; E Package RS-0483 twice at 20 L on 15 Aug; LOT-05 three double-fills; Lot 2's ZA-7290 and ZA-7968 pairs; IRD-03's PH-6742 pair) — a `day|code|litres` key destroys all of them;
- it solves LOT-04's half-imported 13 Aug correctly and automatically: the DB holds 1 row each for 6 distinct assets that day, the sheet holds 19 rows, and the count key emits exactly the 13 missing ones — no date fudging, no 380 L lost, no 110 L doubled.

But it is blind to litres, so it cannot tell a *corrected* row from a duplicate, and it leaves no audit trail tying a DB row back to a sheet row.

**Recommended (requires your approval — it is a schema migration):** add

```prisma
importKey String? @unique   // sha1("<sourceFile>|<sheet>|<excelRow>|<projectCode>")
```

to `FuelIssue`. Key on **row identity**, not value identity. Then:
- re-running the same workbook is a guaranteed no-op regardless of how values were edited between runs;
- a corrected litre figure on the same sheet row surfaces as an *update candidate* the run reports and refuses to apply silently, instead of appearing as a new charge;
- same-day repeat fills are never collapsed, because they are different sheet rows;
- reconciliation by source file finally becomes possible — which is exactly the capability whose absence let PALO's 5 duplicates hide under a legitimate source string for three weeks.

Run order becomes: `importKey` lookup first (hard skip), `(day, assetId)` count second (catches the six historical loads whose scripts are gone and which therefore carry no key), meter guard third, write fourth.

**Fallback if no migration is permitted:** deterministic composite key `(bulkTankId, Colombo day, assetId, litres, ordinal-within-group)` computed in sheet order, held in a side table or recomputed each run. No schema change, still deterministic, still preserves repeat fills — but it cannot distinguish a corrected value from a new one, and it cannot reconcile by source file. It is second-best and I'd rather have the column.

**Additionally:** dry-run is the default (`--apply` to write); stock movement is a *separate* flag (`--decrement-stock`) and is off for every site in this batch; every run writes its report to a dated log so two runs can be diffed.

---

## 5. Verification after any import

Run all of this **per site, on a restored copy first**, and compare against a pre-import snapshot.

**Counts and litres**
1. Sheet rows in range vs `FuelIssue` rows created — must match the profile's expected number exactly (the table in §2). Any variance is a bug, not a rounding difference.
2. Sum of litres created vs the profile's expected litres. **Sum the rows — never read a total cell.** Galagedara's and E Package's totals are uncached formulas that read blank; Wadakada's daily sums disagree with the storekeeper's written total on 8 and 10 Aug.
3. `SELECT source, COUNT(*), SUM(litres)` grouped by source for the whole of August, before and after. Only the new source strings should change.

**Per-day reconciliation, across the whole month — not just the new range**
4. Workbook per-day litres vs DB per-day litres for 1–28 Aug. This is what surfaces the pre-existing defects: CEP-03E's 2–6 Aug (DB 51/1,282 vs book 41/977), CEP-03W's 1–12 Aug (DB 105/3,045 vs book 96/2,750), BATTI-02's 1–3 Aug (+95 L), CEP-03F's four divergent days (25/27/28 Jul, 5 Aug). If those deltas change after the import, the import touched history it shouldn't have.

**Cross-site duplicate sweep — the one that matters most here**
5. `(Colombo day, asset code, litres)` across **all** tanks for 2026-08-10 → 2026-08-28, grouped, count > 1. This is the single query that catches the class of error dominating this batch: E Package↔Galagedara on 23 Aug, Ruwanwella↔Galagedara on 11 Aug, Wadakada↔Muttur on 13–14 Aug. Expect a small number of legitimate hits (a machine genuinely fuelled at two pumps in a day) — review each by hand, do not auto-void.

**Fleet integrity**
6. `Asset` row count before vs after — **must be identical.** Any new asset means an unmatched code slipped through and a fake machine now exists.
7. `AssetAssignment` rows created — review every one. No machine posted to another project should gain a new open-ended posting from a fuel import.
8. `MeterReading` count created vs rows carrying a usable meter; and per asset, `MAX(value)` must not have decreased. Expect **zero** meter readings from LOT-04 (totaliser) and from Ruwanwella's genuine rows (all `N/A`).

**Tank balances — these will move, and three go negative**

| Tank | Before | After | Note |
|---|---:|---:|---|
| Mannarama (MANN) | 0 L | **−595 L** | No receipts recorded at all |
| ICDP Batti Lot-03 (BATTI-03) | 0 L | **−2,113 L** | No receipts recorded |
| ICDP Batti Lot-02 (BATTI-02) | 85 L | **−3,488 L** | No receipt/balance footer in the workbook |
| EP I-Road Lot-04 (IRD-04) | *read before run* | −2,003 L | Plus 2,143 L dispensed and untranscribed |
| Mutur Plant (MUTUR) | 437 L | 417 L | Only healthy movement in the batch |
| CEP-03F / CEP-03E / CEP-03W / RUWA / ING / IRD-03 | *read before run* | −8,248 / −1,275 / −470 / −1,180 / −824 / −1,675 L | Receipts side not yet reconciled |

Three tanks go negative on the numbers available. **That is a receipts-side gap, not an import bug** — the issue side is being brought forward without the corresponding deliveries. It must be triaged before any invoice is cut, and it is the reason `--decrement-stock` should stay off for this entire batch until receipts are loaded.

Two receipt-side anomalies to chase specifically: Wadakada books 400 L received on 27 Aug and 400 L on 28 Aug, but Badalgama's pump records `SITE-WCP` transfers into Wadakada only up to 17 Aug — those two days have no counterpart. And Wadakada's 200 L `Transfer Package-E` has no receiving-side row at CEP-03E.

**Bills**
9. Re-run the August 2026 draft per site and diff against the pre-import draft. Expect movement on all 11 producing sites. July and earlier must be **byte-identical** — if any closed month moves, stop and roll back.
10. Cross-site cost movement is expected and correct (fuel is attributed by the pump, not by the machine's home posting): `PH-6747`→WCP fuelling at BATTI-02 (19 events), `LO-4823`→WCP at BATTI-03, `LP 1573`/`LO 7184`→WCP at IRD-04, `DT-75`→WCP at ING, `MG-10`→MRS at MANN, and 18 of Galagedara's 41 codes resolving to other projects. Confirm each moves cost in the intended direction before billing.

---

## 6. What I should NOT do without asking you first

1. **Run anything with `--apply` against `data/app.db`.** Per your standing note, this repo is public and this DB is the live one. Every run in this plan is dry-run against a restored copy until you say otherwise.
2. **Touch tank stock.** No `--decrement-stock`, no `--set-stock`. Wadakada's `--set-stock` in particular is now provably unsafe — its reconciliation chain breaks twice (+380 L on 10 Aug, −25 L between 14 and 27 Aug) and setting stock from it would bake both breaks in.
3. **Re-run any REPLACE-style importer.** `import_stock_book.ts` (KARA/PALO), `import_galagedara_monthly.ts`, `import_consolidated_register.cjs` and `import_lot02_muthur.ts` all delete before inserting. Each has zero new rows to contribute and each would destroy existing correct data.
4. **Void or delete the four pre-existing double-charges** — PALO 260 L, CEP-03E 310 L, CEP-03W ~295 L, BATTI-02 95 L (≈960 L, real client money). These are genuine defects and they should be cleared before August is billed, but the system's own path is a `FuelIssueCorrection` with **required evidence** (`docData` is non-nullable). That is a deliberate control. I will identify the exact row IDs and hand you the list; I will not raise or approve the corrections.
5. **Rewrite BATTI-03's dates in the client's workbook.** The 2025→2026 correction is certain, but the folders are the client's transcription record. It goes in the importer config as a documented override, or the site re-issues the file. Your call which.
6. **Resolve any ambiguous machine code by guessing.** Specifically: `226-3644` (fleet has both `226-3944` and `226-3544` at the same site, sharing drivers), `AD-1980`, `LK-2615`, `LP-1976`, `LA-4225` (its near-match regNo belongs to two assets), `LO-7183` vs `LP-7183` (probably one truck registered twice — merging them moves 30 L and a full meter history), and `MQ 17` vs `MG 17` (already split across two asset records). Each of these puts one machine's fuel on another's permanent record where nothing downstream will ever reveal it.
7. **Create the `SITE-PKGE` / `SITE-CEP03E` pseudo-asset** needed for Wadakada's 200 L transfer, or decide which tank it debits.
8. **Add the `importKey` column.** It is a schema migration on a live, published database.
9. **Invoice August 2026.** Even after this import lands in full, August is incomplete: LOT-04 is missing 2,143 L (ledger sheet 3610 never transcribed), IRD-03 is missing nine working days, CEP-03W is missing 15–26 Aug, CEP-03F is missing six days, and three tanks are negative. Your existing note says August stops at 13 Aug and must not be invoiced — this import moves that line to 28 Aug for most sites but does not clear the note.
10. **Commit or push anything.** The repo is public with a live DB and working admin credentials already published.

### Suggested order of work

1. Build the core + long reader + profile registry, and land **MANN (595 L)** and **MUTUR (20 L)** first — smallest, cleanest, and they prove the pipeline end-to-end.
2. Then **IRD-03**, **ING**, **BATTI-02** — moderate, need alias tables but no cross-site decisions.
3. Get your decisions on: the E Package/Galagedara 23 Aug ownership, the BATTI-03 year override, the Wadakada transfer pseudo-asset, and the ambiguous codes.
4. Then **CEP-03F**, **CEP-03E**, **RUWA**, **IRD-04**, **BATTI-03**, **CEP-03W**.
5. Clear the four pre-existing double-charges via the correction workflow.
6. Reconcile the receipts side before anything is billed.