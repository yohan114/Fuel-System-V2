/**
 * Imports the standard fuel-consumption bands (Cons Econ / Cons Typ / Cons Heavy)
 * from the "Fuel Rates" sheet of the 2026 fleet pricing workbook into
 * RentalRate.fuelConsEcon / fuelConsTyp / fuelConsHeavy / fuelConsBasis.
 *
 * Dry-run by default; pass --apply to commit. Idempotent — re-running writes the
 * same values and reports 0 changes.
 *
 *   node scripts/import-fuel-consumption.cjs                       # dry-run
 *   node scripts/import-fuel-consumption.cjs --apply               # commit
 *   node scripts/import-fuel-consumption.cjs --xlsx "<path>"       # other workbook
 *   node scripts/import-fuel-consumption.cjs --db "<path>"         # rehearse on a copy
 *   node scripts/import-fuel-consumption.cjs --force-model-mismatch
 *
 * ── UNITS (the trap) ────────────────────────────────────────────────────────
 * The workbook stores machinery as L/hr (Unit = "L/hr") and road vehicles as
 * km/L (Unit = "km/L"). The DATABASE stores litres-per-unit for BOTH bases:
 * L/hr for basis 'hr' and L/km for basis 'km'. So km/L rows must be INVERTED:
 *
 *     L_per_km = 1 / km_per_L
 *
 * Inversion reverses the ordering. In km/L, Econ is the LARGEST number (best
 * economy); after inversion Econ is the SMALLEST. The DB invariant for both
 * bases is therefore econ < typ < heavy — HIGHER IS WORSE. Verified against 176
 * km-basis rows already in the DB: 176/176 satisfy db = 1/workbook exactly.
 *
 * ── BASIS ───────────────────────────────────────────────────────────────────
 * fuelConsBasis is written from the WORKBOOK's Basis column (the physical unit
 * the band is expressed in), never from Asset.meterType. For 94 machines the
 * two disagree (workbook says Hour, the asset is on a KM odometer). Writing the
 * meter would silently relabel L/hr figures as L/km. The mismatch is printed in
 * full under "METER MISMATCH" so it stays visible instead of being papered over.
 *
 * ── ZERO / TOWED ────────────────────────────────────────────────────────────
 * 9 workbook rows (trailers, towed, no engine) carry 0/0/0 with Basis "None".
 * They are SKIPPED, never written as 0. NULL means "no band" to
 * classifyConsumption(); 0 would mean "heavy = 0 L/hr", so any litre at all
 * would classify OVER (a false repair candidate).
 */
const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const path = require("path");
const crypto = require("crypto");

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const FORCE_MODEL = ARGS.includes("--force-model-mismatch");
const xlsxFlag = ARGS.indexOf("--xlsx");
const SRC =
  xlsxFlag >= 0 && ARGS[xlsxFlag + 1]
    ? ARGS[xlsxFlag + 1]
    : "D:/Yohan/Fleet rental Invoice/site-rental-bill-creation-system-claude-serene-einstein-26dhau/Fleet_Rental_Prices_2026 finalz.xlsx";
const dbFlag = ARGS.indexOf("--db");
const DB_PATH = dbFlag >= 0 && ARGS[dbFlag + 1] ? ARGS[dbFlag + 1] : path.join(process.cwd(), "data", "app.db");
const SHEET = "Fuel Rates";
const SOURCE_LABEL = "Fleet_Rental_Prices_2026 finalz.xlsx / Fuel Rates";

// Relative change above which a value swing is treated as material.
const MATERIAL_DELTA = 0.25;

const alnum = (v) => String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const dash = (v) => { const s = String(v ?? "").trim(); return s === "" || s === "—" || s === "-" ? "" : s; };
const r6 = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);
const eq = (a, b) => (a == null && b == null ? true : a == null || b == null ? false : Math.abs(a - b) < 1e-6);
const pad = (v, n) => String(v ?? "").padEnd(n);
// Every existing AuditLog.createdAt and RentalRate.updatedAt in this DB is a
// Prisma ISO string ("2026-08-15T09:03:13.629+00:00"). SQLite's CURRENT_TIMESTAMP
// would write "2026-08-15 09:03:13", which sorts BELOW every Prisma row in the
// admin audit list's ORDER BY createdAt DESC — the entry would vanish off the
// bottom. Write the same shape the app writes.
const NOW_ISO = new Date().toISOString().replace("Z", "+00:00");

// ── 1. Read the sheet ───────────────────────────────────────────────────────
const wb = XLSX.readFile(SRC, { cellDates: true });
if (!wb.Sheets[SHEET]) { console.error(`Sheet "${SHEET}" not found in ${SRC}. Sheets: ${wb.SheetNames.join(", ")}`); process.exit(1); }
const grid = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, raw: true, defval: null });

// Locate the header row rather than hard-coding it (the sheet has a preamble).
const hdrRow = grid.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() === "Cons Typ"));
if (hdrRow < 0) { console.error(`Could not find the "Cons Typ" header row in "${SHEET}".`); process.exit(1); }
const COL = {};
grid[hdrRow].forEach((h, i) => { const k = String(h ?? "").trim(); if (k) COL[k] = i; });
for (const need of ["E&C No", "Reg No", "Model", "Basis", "Unit", "Cons Econ", "Cons Typ", "Cons Heavy"]) {
  if (COL[need] === undefined) { console.error(`Missing column "${need}" in "${SHEET}".`); process.exit(1); }
}
// Data rows carry a numeric "#"; the trailing note lines do not.
const sheetRows = grid.slice(hdrRow + 1).filter((r) => Array.isArray(r) && typeof r[0] === "number");
const g = (r, k) => r[COL[k]];

// ── 2. Convert to DB units ──────────────────────────────────────────────────
// Returns null for towed/no-engine rows (Basis "None", Unit "—", 0/0/0).
function toDbUnits(r) {
  const unit = String(g(r, "Unit") ?? "").trim();
  const econ = g(r, "Cons Econ"), typ = g(r, "Cons Typ"), heavy = g(r, "Cons Heavy");
  const nums = [econ, typ, heavy];
  if (nums.some((v) => typeof v !== "number")) return { skip: "non-numeric consumption" };
  if (nums.every((v) => v === 0)) return { skip: "towed / no engine (0/0/0)" };
  if (unit === "L/hr") {
    if (!(econ < typ && typ < heavy)) return { skip: `bad L/hr ordering ${econ}/${typ}/${heavy}` };
    return { econ: r6(econ), typ: r6(typ), heavy: r6(heavy), basis: "hr" };
  }
  if (unit === "km/L") {
    if (!(econ > 0 && typ > 0 && heavy > 0)) return { skip: `non-positive km/L ${econ}/${typ}/${heavy}` };
    if (!(econ > typ && typ > heavy)) return { skip: `bad km/L ordering ${econ}/${typ}/${heavy}` };
    // INVERT: km/L → L/km. Ordering flips, so econ becomes the smallest.
    return { econ: r6(1 / econ), typ: r6(1 / typ), heavy: r6(1 / heavy), basis: "km" };
  }
  return { skip: `unknown Unit "${unit}"` };
}

// ── 3. Load assets (read side) ──────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

const assets = db
  .prepare(`SELECT a.id, a.code, a.regNo, a.model, a.meterType, a.status,
                   r.id AS rateId, r.fuelConsEcon AS e, r.fuelConsTyp AS t,
                   r.fuelConsHeavy AS h, r.fuelConsBasis AS b
            FROM Asset a LEFT JOIN RentalRate r ON r.assetId = a.id`)
  .all();

// Prefer an ACTIVE asset when a normalised key resolves to more than one.
const byCode = new Map(), byReg = new Map();
const put = (m, k, a) => { if (!k) return; const cur = m.get(k); if (!cur || (cur.status !== "ACTIVE" && a.status === "ACTIVE")) m.set(k, a); };
for (const a of assets) { put(byCode, alnum(a.code), a); put(byReg, alnum(a.regNo), a); }

// ── 4. Match — each asset may be claimed by at most one workbook row ────────
// Strength-ordered passes, NOT sheet order: every E&C No → Asset.code match is
// settled before any Reg No match is considered, so a row that names the asset
// by its E&C number always beats a row that only shares its number plate. That
// is what keeps WB-15 on its own 8 L/hr row (#504) instead of one of the three
// 0/0/0 trailer rows that reuse the plate RY-2390, and what routes the mis-keyed
// "LB-19 / ZB-1979" row (#31) onto LB-20 once LB-19 is taken by row #30.
const CAND = [
  ["code",     (r) => { const k = dash(g(r, "E&C No")); return k ? byCode.get(alnum(k)) : undefined; }],
  ["regNo",    (r) => { const k = dash(g(r, "Reg No")); return k ? byReg.get(alnum(k)) : undefined; }],
  ["ec→regNo", (r) => { const k = dash(g(r, "E&C No")); return k ? byReg.get(alnum(k)) : undefined; }],
  ["reg→code", (r) => { const k = dash(g(r, "Reg No")); return k ? byCode.get(alnum(k)) : undefined; }],
];
const claimed = new Map(); // assetId -> row #
const hit = new Map(); // sheet row -> {asset, how}
for (const [how, key] of CAND) {
  for (const r of sheetRows) {
    if (hit.has(r)) continue;
    const a = key(r);
    if (!a || claimed.has(a.id)) continue;
    claimed.set(a.id, g(r, "#"));
    hit.set(r, { asset: a, how });
  }
}
const matched = [], unmatched = [], collided = [];
for (const r of sheetRows) {
  const h = hit.get(r);
  if (h) { matched.push({ r, ...h }); continue; }
  const cands = CAND.map(([, key]) => key(r)).filter(Boolean);
  (cands.length ? collided : unmatched).push({ r, cands });
}

// ── 5. Plan ─────────────────────────────────────────────────────────────────
const writes = [], skipped = [], held = [], noRate = [], mismatch = [], unchanged = [];
for (const m of matched) {
  const conv = toDbUnits(m.r);
  if (conv.skip) { skipped.push({ ...m, why: conv.skip }); continue; }
  if (!m.asset.rateId) { noRate.push({ ...m, conv }); continue; }

  // Model guard: if the workbook's model text and the asset's model disagree AND
  // the numbers move materially, the two sources are probably describing
  // different machines (e.g. two excavator codes transposed). Hold, don't guess.
  const wbModel = alnum(g(m.r, "Model")), dbModel = alnum(m.asset.model);
  const modelsDiffer = wbModel && dbModel && dbModel !== "UNKNOWN" && wbModel !== dbModel && !wbModel.includes(dbModel) && !dbModel.includes(wbModel);
  const big = m.asset.t != null && conv.typ != null && Math.abs(conv.typ - m.asset.t) / Math.max(m.asset.t, conv.typ) > MATERIAL_DELTA;
  if (modelsDiffer && big && !FORCE_MODEL) { held.push({ ...m, conv }); continue; }

  const changed = !eq(m.asset.e, conv.econ) || !eq(m.asset.t, conv.typ) || !eq(m.asset.h, conv.heavy) || m.asset.b !== conv.basis;
  (changed ? writes : unchanged).push({ ...m, conv });

  const meterBasis = m.asset.meterType === "KM" ? "km" : "hr";
  if (meterBasis !== conv.basis) mismatch.push({ ...m, conv, meterBasis });
}

// ── 6. Report ───────────────────────────────────────────────────────────────
const L = (s = "") => console.log(s);
L(`\n════ FUEL CONSUMPTION BAND IMPORT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`Source : ${SRC}`);
L(`DB     : ${DB_PATH}`);
L(`Sheet  : "${SHEET}"  header row ${hdrRow}  data rows ${sheetRows.length}`);
L(`Target : RentalRate.fuelConsEcon / fuelConsTyp / fuelConsHeavy / fuelConsBasis`);

L(`\n── MATCHING ──`);
const byHow = {};
for (const m of matched) byHow[m.how] = (byHow[m.how] || 0) + 1;
L(`  matched      ${String(matched.length).padStart(4)}  (${Object.entries(byHow).map(([k, v]) => `${k}=${v}`).join(", ")})`);
L(`  unmatched    ${String(unmatched.length).padStart(4)}`);
L(`  collided     ${String(collided.length).padStart(4)}  (every candidate asset already claimed by an earlier row)`);
for (const u of unmatched) L(`     unmatched  #${pad(g(u.r, "#"), 4)} E&C=${pad(dash(g(u.r, "E&C No")) || "—", 10)} Reg=${pad(dash(g(u.r, "Reg No")) || "—", 11)} ${pad(g(u.r, "Category"), 20)} typ=${g(u.r, "Cons Typ")} ${g(u.r, "Unit")}`);
for (const c of collided) { const uniq = [...new Map(c.cands.map((a) => [a.id, a])).values()]; L(`     collided   #${pad(g(c.r, "#"), 4)} E&C=${pad(dash(g(c.r, "E&C No")) || "—", 10)} Reg=${pad(dash(g(c.r, "Reg No")) || "—", 11)} → ${uniq.map((a) => `${a.code} (taken by row #${claimed.get(a.id)})`).join(", ")}`); }

L(`\n── SKIPPED (no band written, values left NULL) ──`);
if (!skipped.length) L(`  none`);
for (const s of skipped) L(`  ${pad(s.asset.code, 10)} ${pad(dash(s.asset.regNo) || "—", 11)} ${s.why}`);

if (noRate.length) {
  L(`\n── NO RATE CARD (would need an INSERT — this import only UPDATEs) ──`);
  for (const n of noRate) L(`  ${pad(n.asset.code, 10)} ${pad(dash(n.asset.regNo) || "—", 11)}`);
}

L(`\n── HELD: workbook model disagrees with the asset AND the number moves >${MATERIAL_DELTA * 100}% ──`);
if (!held.length) L(`  none`);
for (const h of held) {
  L(`  ${pad(h.asset.code, 10)} db "${h.asset.model}" ${h.asset.e}/${h.asset.t}/${h.asset.h ?? "—"} ${h.asset.b}`);
  L(`  ${" ".repeat(10)} wb "${g(h.r, "Model")}" → ${h.conv.econ}/${h.conv.typ}/${h.conv.heavy} ${h.conv.basis}   [row #${g(h.r, "#")}]`);
}
if (held.length) L(`  → resolve by hand, or re-run with --force-model-mismatch to take the workbook's word.`);

L(`\n── METER MISMATCH: workbook band basis ≠ Asset.meterType (${mismatch.length}) ──`);
L(`  The band is written in the workbook's physical unit. On these machines the`);
L(`  meter cannot measure it, so consumption health reports NO_BAND until the`);
L(`  meter is corrected. NOT fixed here — surfaced only.`);
const mmGroups = {};
for (const m of mismatch) { const k = `asset ${m.meterBasis} vs workbook ${m.conv.basis}`; (mmGroups[k] ||= []).push(m.asset.code); }
for (const [k, codes] of Object.entries(mmGroups)) { L(`  ${k}  (${codes.length})`); L(`    ${codes.join(", ")}`); }

L(`\n── WRITES ──`);
let fillEcon = 0, fillTyp = 0, fillHeavy = 0, fillBasis = 0, chgEcon = 0, chgTyp = 0, chgBasis = 0;
for (const w of writes) {
  if (w.asset.e == null) fillEcon++; else if (!eq(w.asset.e, w.conv.econ)) chgEcon++;
  if (w.asset.t == null) fillTyp++; else if (!eq(w.asset.t, w.conv.typ)) chgTyp++;
  if (w.asset.h == null) fillHeavy++;
  if (w.asset.b == null) fillBasis++; else if (w.asset.b !== w.conv.basis) chgBasis++;
}
L(`  rows to update   ${String(writes.length).padStart(4)}`);
L(`  already correct  ${String(unchanged.length).padStart(4)}  (idempotent no-op)`);
L(`  econ  : ${fillEcon} filled from NULL, ${chgEcon} value changed`);
L(`  typ   : ${fillTyp} filled from NULL, ${chgTyp} value changed`);
L(`  heavy : ${fillHeavy} filled from NULL`);
L(`  basis : ${fillBasis} filled from NULL, ${chgBasis} value changed`);
const valueChanges = writes.filter((w) => (w.asset.e != null && !eq(w.asset.e, w.conv.econ)) || (w.asset.t != null && !eq(w.asset.t, w.conv.typ)) || (w.asset.b != null && w.asset.b !== w.conv.basis));
L(`\n  ── existing non-NULL values that MOVE (${valueChanges.length}) ──`);
if (!valueChanges.length) L(`     none`);
for (const w of valueChanges) L(`     ${pad(w.asset.code, 10)} ${w.asset.e}/${w.asset.t}/${w.asset.h ?? "—"} ${w.asset.b}  →  ${w.conv.econ}/${w.conv.typ}/${w.conv.heavy} ${w.conv.basis}`);
const billed = writes.filter((w) => valueChanges.includes(w)).map((w) => w.asset.id);
if (billed.length) {
  const q = db.prepare(`SELECT COUNT(*) n FROM Bill WHERE assetId IN (${billed.map(() => "?").join(",")})`).get(...billed);
  const qd = db.prepare(`SELECT COUNT(*) n FROM Bill WHERE derivedFromFuel = 1 AND assetId IN (${billed.map(() => "?").join(",")})`).get(...billed);
  L(`\n  bills already raised against those assets: ${q.n} (${qd.n} fuel-derived) — existing bills carry their own snapshots and are NOT rewritten.`);
}

// ── 7. Write ────────────────────────────────────────────────────────────────
// Undo file first. BillRevision covers bills, but nothing else snapshots a rate
// card, so without this the only way back from --apply is re-deriving from the
// workbook — which is impossible for any card the workbook does not cover.
if (APPLY) {
  const before = db
    .prepare(`SELECT r.id, a.code, r.fuelConsEcon, r.fuelConsTyp, r.fuelConsHeavy, r.fuelConsBasis
              FROM RentalRate r JOIN Asset a ON a.id = r.assetId`)
    .all();
  const undoPath = `backups/rental-rate-bands-before-${NOW_ISO.slice(0, 10).replace(/-/g, "")}.json`;
  require("fs").mkdirSync("backups", { recursive: true });
  require("fs").writeFileSync(
    undoPath,
    JSON.stringify({ takenAt: NOW_ISO, source: SOURCE_LABEL, rows: before }, null, 1)
  );
  L(`\n── UNDO FILE ──`);
  L(`  ${before.length} rate cards snapshotted to ${undoPath}`);
  L(`  restore with: UPDATE RentalRate SET fuelConsEcon=?, fuelConsTyp=?, fuelConsHeavy=?, fuelConsBasis=? WHERE id=?`);
}

const upd = db.prepare(`UPDATE RentalRate
     SET fuelConsEcon = @econ, fuelConsTyp = @typ, fuelConsHeavy = @heavy,
         fuelConsBasis = @basis, updatedAt = @now
   WHERE id = @rateId`);

db.exec("BEGIN");
try {
  for (const w of writes) upd.run({ econ: w.conv.econ, typ: w.conv.typ, heavy: w.conv.heavy, basis: w.conv.basis, rateId: w.asset.rateId, now: NOW_ISO });

  const meta = {
    source: SOURCE_LABEL, sheet: SHEET, sheetRows: sheetRows.length,
    matched: matched.length, unmatched: unmatched.length, collided: collided.length,
    updated: writes.length, unchanged: unchanged.length,
    econFilled: fillEcon, econChanged: chgEcon, typFilled: fillTyp, typChanged: chgTyp,
    heavyFilled: fillHeavy, basisFilled: fillBasis, basisChanged: chgBasis,
    skippedTowed: skipped.length, heldModelMismatch: held.map((h) => h.asset.code),
    valueChanges: valueChanges.map((w) => ({ code: w.asset.code, from: [w.asset.e, w.asset.t, w.asset.h, w.asset.b], to: [w.conv.econ, w.conv.typ, w.conv.heavy, w.conv.basis] })),
    meterMismatch: { count: mismatch.length, codes: mismatch.map((m) => m.asset.code) },
    unitsNote: "km/L workbook values inverted to L/km; L/hr taken as-is. DB invariant econ < typ < heavy.",
  };
  db.prepare(`INSERT INTO AuditLog (id, action, entity, entityId, summary, metaJson, createdAt)
              VALUES (@id, 'UPDATE', 'RentalRate', NULL, @summary, @metaJson, @now)`)
    .run({
      id: crypto.randomUUID(),
      now: NOW_ISO,
      summary: `Imported standard fuel-consumption bands (econ/typ/heavy) from the 2026 Fuel Rates sheet: ${writes.length} rate cards updated, ${fillHeavy} given a heavy band for the first time, ${skipped.length} towed units left without a band, ${held.length} held on a model mismatch. ${mismatch.length} machines carry an hour-based band but sit on a KM odometer.`,
      metaJson: JSON.stringify(meta),
    });

  // ── 8. Reconciliation (inside the transaction, before commit/rollback) ────
  const rec = db.prepare(`SELECT COUNT(*) total,
      SUM(fuelConsEcon IS NOT NULL) econ, SUM(fuelConsTyp IS NOT NULL) typ,
      SUM(fuelConsHeavy IS NOT NULL) heavy, SUM(fuelConsBasis IS NOT NULL) basis,
      SUM(fuelConsTyp = 0) zeroTyp FROM RentalRate`).get();
  const ord = db.prepare(`SELECT COUNT(*) n FROM RentalRate
      WHERE fuelConsEcon IS NOT NULL AND fuelConsTyp IS NOT NULL AND fuelConsHeavy IS NOT NULL
        AND NOT (fuelConsEcon < fuelConsTyp AND fuelConsTyp < fuelConsHeavy)`).get();
  const perBasis = db.prepare(`SELECT fuelConsBasis b, COUNT(*) n, MIN(fuelConsTyp) mn, MAX(fuelConsTyp) mx
      FROM RentalRate WHERE fuelConsTyp IS NOT NULL GROUP BY 1`).all();
  L(`\n── RECONCILIATION (post-write, pre-${APPLY ? "commit" : "rollback"}) ──`);
  L(`  RentalRate rows              ${rec.total}`);
  L(`  with econ / typ / heavy      ${rec.econ} / ${rec.typ} / ${rec.heavy}`);
  L(`  with basis                   ${rec.basis}`);
  L(`  fuelConsTyp = 0              ${rec.zeroTyp}   (must be 0 — generate.ts guards >0, classify would flag OVER)`);
  L(`  econ<typ<heavy violations    ${ord.n}   (must be 0)`);
  for (const p of perBasis) L(`  basis ${pad(p.b ?? "NULL", 5)} n=${String(p.n).padStart(3)}  typ range ${p.mn} … ${p.mx}  (${p.b === "km" ? "L/km" : p.b === "hr" ? "L/hr" : "—"})`);
  if (rec.zeroTyp > 0 || ord.n > 0) throw new Error("Reconciliation failed — refusing to commit.");

  if (APPLY) { db.exec("COMMIT"); L(`\n✓ APPLIED. ${writes.length} rate cards updated, 1 AuditLog row written.`); }
  else { db.exec("ROLLBACK"); L(`\n(DRY-RUN) nothing written — re-run with --apply.`); }
} catch (err) {
  db.exec("ROLLBACK");
  console.error(`\n✗ ROLLED BACK: ${err.message}`);
  db.close();
  process.exit(1);
}
db.close();
