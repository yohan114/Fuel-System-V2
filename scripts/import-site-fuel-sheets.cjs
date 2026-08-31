/**
 * Import fuel issues from the site workbooks, without creating duplicates.
 *
 * TWO FORMATS ARE HANDLED, and a third is deliberately refused.
 *
 *   A. Daily issuing grid — the standard E&C sheet. A header row naming
 *      "Vehicle Reg.", a "Day" band numbered 1..31, and litres in the cells.
 *      Column ORDER varies between sites (Marawila puts Company Code third,
 *      CEP-03 E puts it fifth, Lot 02 has an unlabelled Hire/E&C column before
 *      the days), so every column is located by reading the header, never by
 *      position.
 *
 *   B. Diesel stock ledger — LOT-04.xlsx. A running book: Date, GRN,
 *      Description, Received Qty, Issues Qty, Balance. A row is an ISSUE when
 *      Description holds a vehicle and Issues Qty is set; rows with a GRN and
 *      Received Qty are deliveries into the tank and are not issues.
 *
 *   C. Monthly running summary — REFUSED. Inginimitiya, Ruwanwella running
 *      summary and Batti ICDP LOT-02 - New are not issuing sheets at all: they
 *      carry one row per vehicle per MONTH with days, distance, a fuel TOTAL,
 *      rate and amount. There are no dates. Importing them as fuel issues would
 *      invent an issue date and double-count against any daily sheet covering
 *      the same month.
 *
 * DUPLICATES. A fuel issue is taken to be the same one when it is the same
 * vehicle, on the same Colombo calendar day, from the same site's tank. Litres
 * are deliberately NOT part of the key: a corrected figure for a day already
 * recorded is the same issue, not a second one, and the owner asked that
 * anything already in the system be left alone.
 *
 *   node scripts/import-site-fuel-sheets.cjs                 # dry run
 *   node scripts/import-site-fuel-sheets.cjs --apply
 *   node scripts/import-site-fuel-sheets.cjs --file "Marawila site.xlsx"
 */
const XLSX = require("xlsx");
const Database = require("better-sqlite3");
const fs = require("fs");

const DIR = process.env.SHEET_DIR || "C:/Users/HP/Downloads/";
const DB = process.env.FUEL_DB || "data/app.db";
const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--file");
const ONLY = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null;

const db = new Database(DB);
db.pragma("foreign_keys = ON");
const L = (s = "") => console.log(s);
const pad = (v, n) => String(v ?? "").padEnd(n);
const padL = (v, n) => String(v ?? "").padStart(n);
const NOW = new Date().toISOString().replace("Z", "+00:00");
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const badDates = new Set();

// A Colombo calendar day is stored at 18:30:00Z on the day before.
const atColombo = (d) => new Date(`${d}T00:00:00+05:30`).toISOString().replace("Z", "+00:00");
const cd = (e) => `date(datetime(${e},'+5 hours','+30 minutes'))`;

const MONTHS = {
  jan: 1, feb: 2, fbr: 2, mar: 3, mrch: 3, apr: 4, aprail: 4, apral: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, now: 11, dec: 12,
};

/** "MAY-2026", "Feb 26", " January 2026", "Mrch - 2026", "APRIL" → {y,m} */
function periodFromSheet(name, fallbackYear) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  let mo = null;
  for (const [k, v] of Object.entries(MONTHS)) {
    if (new RegExp(`(^| )${k}`).test(s)) { mo = v; break; }
  }
  if (!mo) return null;
  const ym = s.match(/(20\d\d)/);
  const yy = s.match(/\b(\d\d)\b/);
  const year = ym ? Number(ym[1]) : yy ? 2000 + Number(yy[1]) : fallbackYear;
  if (!year) return null;
  return { y: year, m: mo };
}

const SOURCES = [
  { file: "Marawila site.xlsx", site: "Marawila", format: "grid", fallbackYear: 2025 },
  { file: "Avissawella site fuel report february,march,april,may 05.06.2026.xlsx", site: "Awissawella", format: "grid", fallbackYear: 2026 },
  { file: "Monthly Fuel Consumption Report [Ruwanwalla W_P] (1) (1).xlsx", site: "Ruwanwella", format: "grid", fallbackYear: 2026 },
  { file: "CEP -03 E Package.xlsx", site: "CEP-03 E Package", format: "grid", fallbackYear: 2026 },
  { file: "Lot 02 (1).xlsx", site: "ICDP Batti Lot-02", format: "grid", fallbackYear: 2026 },
  { file: "LOT-04.xlsx", site: "EP I-Road Lot-04", format: "ledger", fallbackYear: 2026 },
  // Wadakada's June/July book lives with the site, not in Downloads. It goes to
  // CEP-03 Wadakada — the live project, holding the fuel, postings and bills.
  // The two look-alikes are dead: CEP-03 Wadakada Plants has never held anything
  // at all, and Wadakada CEP-3 is the older June project that never received a
  // litre though 37 machines are still pinned to it.
  { path: "D:/Projects sites/Wadakada/june & july fuel issued report.xlsx", site: "CEP-03 Wadakada", format: "grid", fallbackYear: 2026 },
];
const REFUSED = [
  ["Inginimitiya Vehicle, Machinery summary.xlsx", "monthly running summary — vehicle/month totals, no issue dates"],
  ["Ruwanwella- Vehicle & machinery running summary.xlsx", "monthly running summary — vehicle/month totals, no issue dates"],
  ["Batti ICDP LOT-02 - New.xlsx", "monthly running summary — vehicle/month totals, no issue dates"],
];

// ── asset matching ───────────────────────────────────────────────────────────
const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const assets = db.prepare("SELECT id, code, regNo, status FROM Asset").all();
const byKey = new Map();
for (const a of assets) {
  for (const k of [squash(a.regNo), squash(a.code)]) {
    if (k && !byKey.has(k)) byKey.set(k, a);
  }
}
// Names a sheet uses that are not the machine's code. Two kinds, both read from
// the audit trail rather than hard-coded here, so they stay correct as the fleet
// is tidied up:
//
//   merges — DAC-6545 was folded into DAH-6545, but a clerk's workbook does not
//   know that, and eighteen Ruwanwella issues would be dropped as unknown;
//
//   sheet aliases — CEP-03 E writes the Kobelco SK200-7 as "SK 200 7", its model
//   rather than its fleet code HEX-23.
for (const r of db.prepare(
  `SELECT metaJson FROM AuditLog WHERE entity='Asset'
     AND (summary LIKE 'Merged duplicate asset%' OR summary LIKE 'Sheet alias%')`).all()) {
  try {
    const m = JSON.parse(r.metaJson || "{}");
    if (!m.from || !m.into) continue;
    const target = byKey.get(squash(m.into));
    if (target && !byKey.has(squash(m.from))) byKey.set(squash(m.from), target);
  } catch { /* an entry without usable metadata tells us nothing */ }
}

function findAsset(reg) {
  const raw = String(reg || "").trim();
  if (!raw) return null;
  const direct = byKey.get(squash(raw));
  if (direct) return direct;
  // "DAA-7422 (Delay entry)" and "Delay Enter -2025/10/16- SK2007" carry the
  // plate alongside a note; take the identifier and drop the commentary.
  const stripped = raw.replace(/\([^)]*\)/g, " ").trim();
  if (stripped !== raw) {
    const s = byKey.get(squash(stripped));
    if (s) return s;
  }
  for (const tok of raw.split(/[\s,;/]+/)) {
    if (tok.length < 4) continue;
    const t = byKey.get(squash(tok));
    if (t) return t;
  }
  return null;
}

// ── existing issues, for the duplicate test ──────────────────────────────────
const existing = new Set(
  db.prepare(`SELECT f.assetId || '|' || ${cd("f.issueDate")} || '|' || t.projectId AS k
              FROM FuelIssue f JOIN BulkTank t ON t.id = f.bulkTankId WHERE f.voided = 0`)
    .all().map((r) => r.k)
);

const admin = db.prepare("SELECT id FROM User WHERE username='admin'").get();
if (!admin) throw new Error("no admin user to attribute the import to");
// Price by the day the fuel was ISSUED, from the AUTO_DIESEL band in force on
// that Colombo day — not by "whatever FuelPrice row happens to sort last".
//
// The previous single-row lookup had two faults and both reached the invoice.
// It had no fuelKind filter, so the latest row overall could be PETROL_95 or
// KEROSENE and every diesel issue would carry that figure. And it ignored the
// issue date, so a June fill was charged at August's price. 286 of the 437 rows
// this script has already written are priced against the wrong band, worth
// Rs 311,636 — those are existing charges and are corrected through
// FuelIssueCorrection with evidence, not by an importer rewriting them.
const PRICES = db.prepare(
  `SELECT id, pricePerLitre, ${cd("effectiveFrom")} AS day
     FROM FuelPrice WHERE fuelKind = 'AUTO_DIESEL' ORDER BY effectiveFrom ASC`
).all();
if (!PRICES.length) throw new Error("no AUTO_DIESEL price on record — cannot price an import");

/** The band in force on a Colombo day, e.g. "2026-08-24". */
function priceOn(day) {
  let hit = PRICES[0];
  for (const p of PRICES) { if (p.day <= day) hit = p; else break; }
  return hit;
}

// ── parsers ──────────────────────────────────────────────────────────────────
function parseGrid(rows, period) {
  // The header row is the one naming the vehicle registration column.
  // "Vehicle Reg.", "Vehicle Reg. No." and the misspelled "Vehile Reg.No" that
  // Lot 02's February sheet uses all have to match.
  const REG_HDR = /veh\w*\s*reg/i;
  const hdr = rows.findIndex((r) => (r || []).some((c) => REG_HDR.test(String(c || ""))));
  if (hdr < 0) return { rows: [], note: "no vehicle-registration header" };
  const head = rows[hdr] || [];
  const regCol = head.findIndex((c) => REG_HDR.test(String(c || "")));

  // Marawila's November, December and January sheets have the plate typed into
  // the "Type of Vehicle" column with the registration column left empty. Those
  // columns are therefore searched as fallbacks — but only ever accepted when the
  // value matches a real asset, so a genuine type like "Tipper" can never be
  // mistaken for a machine.
  const idCols = [regCol];
  head.forEach((c, i) => {
    if (i !== regCol && /type of veh|company code/i.test(String(c || ""))) idCols.push(i);
  });

  // The day numbers sit on the row below the header (sometimes one further).
  let dayRow = -1;
  for (const i of [hdr + 1, hdr + 2]) {
    const r = rows[i] || [];
    if (r.filter((c) => Number(c) >= 1 && Number(c) <= 31).length >= 20) { dayRow = i; break; }
  }
  if (dayRow < 0) return { rows: [], note: "no day-number row" };

  const dayCols = [];
  (rows[dayRow] || []).forEach((c, i) => {
    const d = Number(c);
    if (Number.isInteger(d) && d >= 1 && d <= 31) dayCols.push({ col: i, day: d });
  });
  const daysInMonth = new Date(period.y, period.m, 0).getDate();

  const out = [];
  for (let i = dayRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    // Take the first identity cell on the row that names a machine we know.
    let reg = "";
    for (const c of idCols) {
      const v = String(r[c] ?? "").trim();
      if (!v) continue;
      if (!reg) reg = v;                       // remember the first non-empty as the label
      if (findAsset(v)) { reg = v; break; }    // but prefer one that actually resolves
    }
    if (!reg || /^total/i.test(reg)) continue;
    // Tank-level footer rows are not vehicles: every sheet ends with the day's
    // opening balance, purchases, total issued and closing balance.
    if (/opening balance|closing balance|fuel purchase|total issue|purchasing/i.test(reg)) continue;
    for (const { col, day } of dayCols) {
      if (day > daysInMonth) continue;              // a 31-column sheet in a 30-day month
      const v = Number(r[col]);
      if (!Number.isFinite(v) || v <= 0) continue;  // blanks and explicit zeros are not issues
      out.push({ reg, day: `${period.y}-${String(period.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`, litres: v });
    }
  }
  return { rows: out, note: null };
}

function parseLedger(rows) {
  const hdr = rows.findIndex((r) => (r || []).some((c) => /^date$/i.test(String(c || "").trim())));
  if (hdr < 0) return { rows: [], note: "no 'Date' header" };
  const head = (rows[hdr] || []).map((c) => String(c || "").toLowerCase().replace(/\s+/g, " ").trim());
  const col = (re) => head.findIndex((h) => re.test(h));
  const cDate = col(/^date$/), cDesc = col(/description/), cIssue = col(/issues? qty/), cGrn = col(/^grn$/);
  if (cDate < 0 || cDesc < 0 || cIssue < 0) return { rows: [], note: "ledger columns not found" };

  const out = [];
  let lastDate = null;
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const raw = r[cDate];
    if (raw != null && String(raw).trim()) {
      const s = String(raw).trim();
      const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
      if (m) lastDate = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
      else if (typeof raw === "number") {
        const d = XLSX.SSF.parse_date_code(raw);
        if (d) lastDate = `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
      }
    }
    const desc = String(r[cDesc] ?? "").trim();
    const litres = Number(r[cIssue]);
    if (!lastDate || !desc || !Number.isFinite(litres) || litres <= 0) continue;
    // A stray number in the date column parses as an Excel serial and lands in
    // 1900. Anything outside the life of this fleet is a misread, not a date.
    if (lastDate < "2020-01-01" || lastDate > TODAY) { badDates.add(lastDate); continue; }
    // A delivery INTO the tank, not an issue out of it.
    if (/received|receiv|opening|balance|total/i.test(desc)) continue;
    if (cGrn > -1 && String(r[cGrn] ?? "").trim() && !/[A-Z]/i.test(desc)) continue;
    out.push({ reg: desc, day: lastDate, litres });
  }
  return { rows: out, note: null };
}

// ── run ──────────────────────────────────────────────────────────────────────
L(`\n════ SITE FUEL SHEET IMPORT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
L(`  reading from ${DIR}`);

const planned = [];
const unmatched = new Map();
const skippedSheets = [];
const seenInRun = new Set();

for (const src of SOURCES) {
  const label = src.file || src.path.split(/[\/]/).pop();
  if (ONLY && label !== ONLY) continue;
  const path = src.path || DIR + src.file;
  if (!fs.existsSync(path)) { L(`\n  MISSING FILE: ${src.file}`); continue; }
  const project = db.prepare("SELECT id, name FROM Project WHERE name = ?").get(src.site);
  const tank = project ? db.prepare("SELECT id, name FROM BulkTank WHERE projectId = ? LIMIT 1").get(project.id) : null;
  if (!project || !tank) { L(`\n  NO PROJECT/TANK for ${src.site} — skipping ${label}`); continue; }

  const wb = XLSX.readFile(path);
  L(`\n── ${src.file}`);
  L(`   site ${project.name}  ·  tank ${tank.name}  ·  ${src.format}`);

  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
    if (rows.length === 0) { skippedSheets.push(`${label} :: ${sheet} — empty`); continue; }

    let period = null;
    if (src.format === "grid") {
      period = periodFromSheet(sheet, src.fallbackYear);
      if (!period) { skippedSheets.push(`${label} :: ${sheet} — no month in the sheet name`); continue; }
      // A template for a month that has not happened cannot hold real issues.
      const today = new Date();
      if (period.y > today.getFullYear() || (period.y === today.getFullYear() && period.m > today.getMonth() + 1)) {
        skippedSheets.push(`${label} :: ${sheet} — future month (${period.y}-${String(period.m).padStart(2, "0")})`);
        continue;
      }
    }

    const { rows: parsed, note } = src.format === "grid" ? parseGrid(rows, period) : parseLedger(rows);
    if (note) { skippedSheets.push(`${label} :: ${sheet} — ${note}`); continue; }

    let neu = 0, dup = 0, unk = 0, dupInRun = 0;
    for (const p of parsed) {
      const asset = findAsset(p.reg);
      if (!asset) {
        unk++;
        const k = `${src.site} :: ${p.reg}`;
        unmatched.set(k, (unmatched.get(k) || 0) + 1);
        continue;
      }
      const key = `${asset.id}|${p.day}|${project.id}`;
      if (existing.has(key)) { dup++; continue; }
      if (seenInRun.has(key)) { dupInRun++; continue; }
      seenInRun.add(key);
      planned.push({ ...p, assetId: asset.id, code: asset.code, tankId: tank.id, projectId: project.id, site: project.name, file: label, sheet });
      neu++;
    }
    const periodLabel = src.format === "grid" ? `${period.y}-${String(period.m).padStart(2, "0")}` : "ledger";
    L(`     ${pad(sheet, 20)} ${pad(periodLabel, 9)} parsed ${padL(parsed.length, 5)}   new ${padL(neu, 5)}   already in system ${padL(dup, 5)}   unknown vehicle ${padL(unk, 4)}${dupInRun ? `   repeated in file ${dupInRun}` : ""}`);
  }
}

L(`\n── SHEETS SKIPPED ──`);
for (const s of skippedSheets) L(`   ${s}`);
if (!skippedSheets.length) L(`   none`);

L(`\n── FILES REFUSED (not fuel issue sheets) ──`);
for (const [f, why] of REFUSED) L(`   ${pad(f, 52)} ${why}`);

if (unmatched.size) {
  L(`\n── VEHICLES NOT IN THE SYSTEM (${unmatched.size} distinct, their issues are NOT imported) ──`);
  for (const [k, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1]))
    L(`   ${pad(k, 46)} ${n} issue(s)`);
}

const byMonth = new Map();
for (const p of planned) {
  const k = `${p.site} ${p.day.slice(0, 7)}`;
  const e = byMonth.get(k) || { n: 0, L: 0 };
  e.n++; e.L += p.litres;
  byMonth.set(k, e);
}
L(`\n── WHAT WOULD BE ADDED ──`);
for (const [k, v] of [...byMonth.entries()].sort())
  L(`   ${pad(k, 34)} ${padL(v.n, 5)} issues   ${padL(Math.round(v.L), 7)} L`);
L(`\n   TOTAL ${planned.length} new issues, ${Math.round(planned.reduce((s, p) => s + p.litres, 0)).toLocaleString()} L`);

if (!APPLY) { L(`\n(DRY-RUN) nothing written — re-run with --apply.`); db.close(); process.exit(0); }
if (planned.length === 0) { L(`\nNothing to add.`); db.close(); process.exit(0); }

const countMultiIssueDays = () =>
  db.prepare(`SELECT COUNT(*) n FROM (
      SELECT f.assetId, ${cd("f.issueDate")} d, t.projectId, COUNT(*) c
      FROM FuelIssue f JOIN BulkTank t ON t.id = f.bulkTankId WHERE f.voided = 0
      GROUP BY f.assetId, d, t.projectId HAVING c > 1)`).get().n;
const dupesBefore = countMultiIssueDays();

const out = db.transaction(() => {
  const before = db.prepare("SELECT COUNT(*) n FROM FuelIssue").get().n;
  const ins = db.prepare(`INSERT INTO FuelIssue
    (id, fuelKind, litres, issueDate, createdAt, assetId, issuedById, bulkTankId, source, voided, pricePerLitre, totalCost, fuelPriceId)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)`);
  for (const p of planned) {
    const band = priceOn(p.day);
    ins.run(crypto.randomUUID(), "AUTO_DIESEL", p.litres, atColombo(p.day), NOW,
      p.assetId, admin.id, p.tankId, `${p.file} :: ${p.sheet}`,
      band.pricePerLitre, Math.round(band.pricePerLitre * p.litres), band.id);
  }
  db.prepare(`INSERT INTO AuditLog (id,action,entity,entityId,summary,metaJson,createdAt,actorId)
              VALUES (?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), "CREATE", "FuelIssue", null,
    `Imported ${planned.length} fuel issues (${Math.round(planned.reduce((s, p) => s + p.litres, 0)).toLocaleString()} L) from ${new Set(planned.map((p) => p.file)).size} site workbook(s). ` +
    `An issue already recorded for the same vehicle, day and site was left untouched. ` +
    `Three workbooks were refused as monthly running summaries rather than issuing sheets: they carry a fuel TOTAL per vehicle per month with no dates, so importing them would invent issue dates and double-count.`,
    JSON.stringify({ added: planned.length, litres: Math.round(planned.reduce((s, p) => s + p.litres, 0)),
      byFile: [...new Set(planned.map((p) => p.file))], unmatched: [...unmatched.keys()] }),
    NOW, admin.id);

  const after = db.prepare("SELECT COUNT(*) n FROM FuelIssue").get().n;
  const dupesAfter = countMultiIssueDays();
  L(`\n── RECONCILIATION ──`);
  L(`   fuel issues ${before} -> ${after}   (+${after - before}, expected +${planned.length})`);
  // A vehicle CAN legitimately be fuelled more than once in a day — a site
  // generator is topped up all day, and 367 such groups already existed before
  // this import. So the test is that the import adds none, not that none exist:
  // demanding zero would fail on the fleet's normal behaviour.
  L(`   vehicle/day/site groups with >1 issue: ${dupesBefore} -> ${dupesAfter}   (must not increase)`);
  if (after - before !== planned.length || dupesAfter > dupesBefore) {
    throw new Error("reconciliation failed — rolling back");
  }
  return { before, after };
})();

L(`\n✓ IMPORTED. ${out.after - out.before} fuel issues added.`);
L(`   foreign key check: ${db.pragma("foreign_key_check").length === 0 ? "clean" : "FAILED"}`);
db.close();
