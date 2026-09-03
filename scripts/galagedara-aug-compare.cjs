// August 2026, Galagedara — the site's workbook beside the system, vehicle by vehicle.
//
//     node scripts/galagedara-aug-compare.cjs
//     DB=/var/lib/fuel-system/app.db node scripts/galagedara-aug-compare.cjs
//
// Writes an xlsx alongside the console table so the two columns can be read next
// to each other without a terminal.
//
// WHICH SYSTEM FIGURE. The site's book records what went out of the Galagedara
// pump, so the honest comparison is fuel drawn FROM that tank — not fuel BILLED
// to the Galagedara project. They are different questions and different numbers:
// a visiting machine fills at Galagedara and is billed to its own site. Both
// totals are printed at the end so the gap between them is visible rather than
// hidden inside whichever one happens to be chosen.
//
// PLATES ARE NOT UNIQUE IN THIS FLEET. Ten registrations are shared by two or
// three assets, so a label that resolves to more than one machine is reported as
// AMBIGUOUS rather than silently attached to whichever came back first.

const path = require("node:path");
const X = require("xlsx");
const Database = require("better-sqlite3");

const BOOK = process.env.BOOK
  || "D:/Projects sites/Galagedara/Galagedara_Fuel_Monthly_and_Vehicle_Allocation.xlsx";
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
const OUT = process.env.OUT || "D:/Fuel system server side/galagedara-aug-comparison.xlsx";
const SITE = "CEP-03F";

// Colombo: a calendar day is stored at 18:30:00Z on the day before.
const FROM = "2026-07-31T18:30:00.000+00:00";
const TO = "2026-08-31T18:30:00.000+00:00";

const serial = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)).toISOString().slice(0, 10);
const alnum = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const r2 = (n) => Math.round(n * 100) / 100;

const db = new Database(DB_PATH, { readonly: true });

// ---------------------------------------------------------------- resolver
const assets = db.prepare("SELECT id, code, regNo FROM Asset").all();
const byCode = new Map();
const byReg = new Map();
const push = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
for (const a of assets) { push(byCode, alnum(a.code), a); push(byReg, alnum(a.regNo), a); }

// Plates written differently in the site's book than in the fleet register.
// Each was confirmed by matching a same-day, same-litre fill, not by how alike
// the strings look — LA-4225 because the book's OWN meter column spells it
// 41-4225 on three of its four rows, and 59-3421 because DC-08 (reg 59-5421)
// carries the identical 14 L on 7 August. Kept as a short explicit list;
// anything not here stays UNMATCHED so it appears in the table instead of
// being quietly folded into some machine that looked close enough.
const ALIAS = {
  "28-1546": "ZB-1546",
  "ZB-7034": "ZA-7034",
  "LO-1580": "LP-1580",
  "LA-4225": "41-4225",
  "59-3421": "59-5421", // DC-08
  "DAT-9762": "DAI-9762",
};

function resolve(label) {
  const raw = String(label ?? "").trim();
  if (!raw) return "(blank)";
  const hit = byCode.get(alnum(ALIAS[raw] ?? raw)) ?? byReg.get(alnum(ALIAS[raw] ?? raw));
  if (!hit) return `UNMATCHED ${raw}`;
  if (hit.length > 1) return `AMBIGUOUS ${raw}`;
  return hit[0].code;
}

// ------------------------------------------------- table 1: the site's book
const excel = new Map();
const sheet = X.readFile(BOOK).Sheets["Fuel Issues"];
if (!sheet) throw new Error(`no "Fuel Issues" sheet in ${BOOK}`);

for (const row of X.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true })) {
  const d = Number(row[0]);
  const litres = Number(row[4]);
  if (!(d > 40000) || !(litres > 0)) continue;          // header rows, blanks, totals
  if (!serial(d).startsWith("2026-08")) continue;
  const code = resolve(row[2]);
  if (!excel.has(code)) excel.set(code, { n: 0, litres: 0, written: new Set() });
  const e = excel.get(code);
  e.n++; e.litres += litres; e.written.add(String(row[2]).trim());
}

// ---------------------------------------------------- table 2: the system
const tank = new Map();
for (const r of db.prepare(`
  SELECT a.code code, COUNT(*) n, ROUND(SUM(f.litres), 2) litres
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  JOIN BulkTank t ON t.id = f.bulkTankId
  JOIN Project p ON p.id = t.projectId
  WHERE p.code = ? AND f.voided = 0 AND f.issueDate >= ? AND f.issueDate < ?
  GROUP BY a.id`).all(SITE, FROM, TO)) tank.set(r.code, r);

// A FuelIssue carries no project of its own — what it is BILLED to is the site
// the machine was assigned to on the day it was filled (AssetAssignment, whose
// endDate is null while the machine is still there).
const posted = db.prepare(`
  SELECT COUNT(*) n, ROUND(SUM(f.litres), 2) litres
  FROM FuelIssue f
  JOIN AssetAssignment g ON g.assetId = f.assetId
    AND g.startDate <= f.issueDate
    AND (g.endDate IS NULL OR g.endDate >= f.issueDate)
  JOIN Project p ON p.id = g.projectId
  WHERE p.code = ? AND f.voided = 0 AND f.issueDate >= ? AND f.issueDate < ?`)
  .get(SITE, FROM, TO);

// ------------------------------------------------------------- the compare
const codes = [...new Set([...excel.keys(), ...tank.keys()])].sort((a, b) => {
  const w = (k) => (tank.get(k)?.litres ?? 0) + (excel.get(k)?.litres ?? 0);
  return w(b) - w(a) || a.localeCompare(b);
});

const rows = [["Vehicle", "Excel issues", "Excel litres", "System issues", "System litres", "Diff (system - excel)", "Written in Excel as"]];
let xn = 0, xl = 0, sn = 0, sl = 0;
const agree = [], differ = [], onlyExcel = [], onlySystem = [];

for (const code of codes) {
  const e = excel.get(code) ?? { n: 0, litres: 0, written: new Set() };
  const s = tank.get(code) ?? { n: 0, litres: 0 };
  xn += e.n; xl += e.litres; sn += s.n; sl += s.litres;
  const diff = r2(s.litres - e.litres);
  const alias = [...e.written].filter((w) => w !== code).join(", ");
  rows.push([code, e.n || "", e.litres || "", s.n || "", s.litres || "", diff || "", alias]);
  const rec = { code, e, s, diff, alias };
  if (!e.n) onlySystem.push(rec);
  else if (!s.n) onlyExcel.push(rec);
  else if (diff === 0) agree.push(rec);
  else differ.push(rec);
}
rows.push([], ["TOTAL", xn, r2(xl), sn, r2(sl), r2(sl - xl), ""]);

// ------------------------------------------------------------------ output
const pad = (s, n) => String(s).padEnd(n);
const cell = (v) => (v.n ? `${v.n} / ${r2(v.litres)}` : "\u2014");
const section = (title, list) => {
  if (!list.length) return;
  console.log(`\n  ${title}  (${list.length})`);
  for (const { code, e, s, diff, alias } of list) {
    console.log(`    ${pad(code, 16)}${pad(cell(e), 16)}${pad(cell(s), 16)}` +
      (diff ? `${diff > 0 ? "+" : ""}${diff} L` : "match") + (alias ? `   [${alias}]` : ""));
  }
};

console.log(`\n=== Galagedara, August 2026 — workbook vs system ===`);
console.log(`    workbook : ${path.basename(BOOK)}  (sheet "Fuel Issues")`);
console.log(`    database : ${DB_PATH}`);
console.log(`\n    ${pad("vehicle", 16)}${pad("EXCEL n/L", 16)}${pad("SYSTEM n/L", 16)}difference`);
section("BOTH AGREE", agree);
section("BOTH HAVE IT, QUANTITIES DIFFER", differ);
section("IN THE SYSTEM, NOT IN THE WORKBOOK", onlySystem);
section("IN THE WORKBOOK, NOT IN THE SYSTEM", onlyExcel);

console.log(`\n  ------------------------------------------------------------`);
console.log(`  EXCEL  "Fuel Issues", August   : ${xn} issues   ${r2(xl)} L`);
console.log(`  SYSTEM fuel from Galagedara tank: ${sn} issues   ${r2(sl)} L`);
console.log(`  difference                      : ${r2(sl - xl) > 0 ? "+" : ""}${r2(sl - xl)} L`);
console.log(`\n  (for reference — billed TO Galagedara, a different question:`);
console.log(`   ${posted.n} issues, ${posted.litres} L)`);

const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), "Aug by vehicle");
X.writeFile(wb, OUT);
console.log(`\n  written: ${OUT}\n`);

db.close();
