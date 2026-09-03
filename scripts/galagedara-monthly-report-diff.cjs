// Reconcile the site's "Monthly Fuel Consumption Report" against the system.
//
//     node scripts/galagedara-monthly-report-diff.cjs
//     SHEET=JULI node scripts/galagedara-monthly-report-diff.cjs
//
// The report is a vehicle x day matrix for CEP/03 (Galagedara): one row per
// machine, one column per day of the month, litres in the cells. It is a
// different document from Galagedara_Fuel_Monthly_and_Vehicle_Allocation.xlsx,
// and it is the one that carries the 23,240 L figure — stated on its own
// "Daily Total Issue" line, and equal to its two block subtotals added up
// (5,498 vehicles + 17,742 machinery).
//
// THE 23,240 IS NOT ALL MACHINE FUEL. Two rows inside the machinery block are
// stock movements, not fills: "Transfer to CEP-.." (1,400 L) and "Transfer
// Package.." (200 L). They belong in the tank's stock account, not against any
// machine, so they are separated here rather than compared to a machine that
// does not exist.
//
// IDENTITY. Vehicles are keyed by registration (column B). Machinery rows leave
// B blank and carry the fleet code in "Company Code" (column C) — GE-117,
// HEX-37, MG-07. A few rows carry both (ZA-4344 / MG-07), and for those the
// company code wins, because that is what the fleet register keys on.

const X = require("xlsx");
const Database = require("better-sqlite3");

const BOOK = process.env.BOOK || "C:/Users/HP/Downloads/Monthly fuel cunsumption summry.xlsx";
const TAB = process.env.SHEET || "Aug";
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
const SITE = "CEP-03F";
const YM = process.env.YM || "2026-08";
const OUT = process.env.OUT || "D:/Fuel system server side/galagedara-aug-report-vs-system.xlsx";

const FROM = `${YM}-01`;
const [Y, M] = YM.split("-").map(Number);
const boundary = (y, m) => {
  // Colombo: the calendar day starts at 18:30Z the evening before.
  const d = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  return new Date(d.getTime() - 5.5 * 3600 * 1000).toISOString().replace("Z", "+00:00");
};
const START = boundary(Y, M);
const END = boundary(M === 12 ? Y + 1 : Y, M === 12 ? 1 : M + 1);

const DAY0 = 5;   // column F = day 1
const DAY1 = 35;  // column AJ = day 31
const COL = { sno: 0, reg: 1, code: 2, type: 3, siteTank: 36, outside: 37, total: 38 };

const alnum = (s) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const r2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => v !== "" && v !== null && Number.isFinite(Number(v));

// ------------------------------------------------------------------ fleet
const db = new Database(DB_PATH, { readonly: true });
const byCode = new Map(), byReg = new Map();
const put = (m, k, v) => { if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); } };
for (const a of db.prepare("SELECT id, code, regNo FROM Asset").all()) {
  put(byCode, alnum(a.code), a); put(byReg, alnum(a.regNo), a);
}
// "Company Code" is not always a code. On hired plant the site writes the word
// "Hired" there, and on a few rows a person's name or a note. Treating those as
// identifiers sent a 770 L dozer to a machine called "Hired" and split one pickup
// across two lines — 1,515 L of pure noise in an earlier run of this report.
const NOT_A_CODE = /^(hired?|n\/?a|-+|)$/i;
// Trailing notes: "PE-3723 (MR Chinthaka surveyor officer)" is PE-3723.
const strip = (s) => String(s ?? "").replace(/\s*\(.*$/, "").trim();
// The site writes hired dozers "D-4/D 2"; the fleet register calls them D4D-02.
// Zero-padding alone will not bridge that, so it is spelled out.
const shape = (s) => {
  const m = /^D-?4\/?D\s*(\d+)$/i.exec(s);
  return m ? `D4D-${String(m[1]).padStart(2, "0")}` : s;
};

function resolve(code, reg) {
  const cands = [code, reg].map(strip).filter((v) => v && !NOT_A_CODE.test(v)).map(shape);
  for (const raw of cands) {
    const hit = byCode.get(alnum(raw)) ?? byReg.get(alnum(raw));
    if (hit && hit.length === 1) return { code: hit[0].code, how: raw };
    if (hit && hit.length > 1) return { code: `AMBIGUOUS ${raw}`, how: raw };
  }
  return { code: `UNMATCHED ${cands[0] ?? code ?? reg}`, how: cands[0] };
}

// --------------------------------------------------------- read the report
const rows = X.utils.sheet_to_json(X.readFile(BOOK).Sheets[TAB], { header: 1, defval: "", raw: true });
if (!rows.length) throw new Error(`sheet "${TAB}" not found in ${BOOK}`);

const report = new Map();   // fleet code -> {days: Map<dayNo, litres>, total, label}
const transfers = [];       // stock movements sitting inside the machinery block
const stated = {};          // the sheet's own summary lines
let blockTotals = [];

for (let i = 0; i < rows.length; i++) {
  const a = rows[i];
  const reg = String(a[COL.reg] ?? "").trim();
  const code = String(a[COL.code] ?? "").trim();
  const label = reg || code;
  if (!label) continue;

  const days = new Map();
  let grid = 0;
  for (let c = DAY0; c <= DAY1; c++) {
    if (!isNum(a[c])) continue;
    days.set(c - DAY0 + 1, Number(a[c]));
    grid += Number(a[c]);
  }

  // The sheet's own arithmetic lines — captured, not compared as machines.
  if (/^total issue for/i.test(label)) { blockTotals.push({ row: i, label, litres: grid }); continue; }
  if (/^(daily|monthly)\s/i.test(label) || /^access fuel|^received /i.test(label)) {
    stated[label.replace(/\s+/g, " ").slice(0, 42)] = grid; continue;
  }
  if (/transfer/i.test(label)) { if (grid) transfers.push({ row: i, label, litres: grid, days }); continue; }
  // Narrative rows: sub-contractors, police station, "correction 2025", repair
  // notes. They carry no fuel; anything that DID carry fuel would show up as an
  // unmatched machine below rather than being dropped here.
  if (!grid) continue;
  if (/sub ?contractor|police|correction|repair|patching|blating|cleaning/i.test(label)) {
    transfers.push({ row: i, label, litres: grid, days, note: "narrative row carrying litres" });
    continue;
  }

  const { code: fleet } = resolve(code, reg);
  if (!report.has(fleet)) report.set(fleet, { days: new Map(), total: 0, labels: new Set() });
  const e = report.get(fleet);
  for (const [d, v] of days) e.days.set(d, (e.days.get(d) ?? 0) + v);
  e.total += grid;
  e.labels.add(label);
}

// --------------------------------------------------------- read the system
const sys = new Map();
for (const r of db.prepare(`
  SELECT a.code code,
         CAST(strftime('%d', f.issueDate, '+5 hours', '+30 minutes') AS INTEGER) d,
         f.litres L
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  JOIN BulkTank t ON t.id = f.bulkTankId
  JOIN Project p ON p.id = t.projectId
  WHERE p.code = ? AND f.voided = 0 AND f.issueDate >= ? AND f.issueDate < ?`)
  .all(SITE, START, END)) {
  if (!sys.has(r.code)) sys.set(r.code, { days: new Map(), total: 0 });
  const e = sys.get(r.code);
  e.days.set(r.d, r2((e.days.get(r.d) ?? 0) + r.L));
  e.total = r2(e.total + r.L);
}

// ---------------------------------------------------------------- compare
const codes = [...new Set([...report.keys(), ...sys.keys()])].sort((a, b) => {
  const w = (k) => (report.get(k)?.total ?? 0) + (sys.get(k)?.total ?? 0);
  return w(b) - w(a) || a.localeCompare(b);
});

const agree = [], differ = [], onlyReport = [], onlySys = [];
let rt = 0, st = 0;
const out = [["Machine", "Report litres", "System litres", "Diff", "Days differing", "Report label"]];

for (const code of codes) {
  const R = report.get(code) ?? { days: new Map(), total: 0, labels: new Set() };
  const S = sys.get(code) ?? { days: new Map(), total: 0 };
  rt += R.total; st += S.total;
  const dayKeys = [...new Set([...R.days.keys(), ...S.days.keys()])].sort((x, y) => x - y);
  const dd = dayKeys.filter((d) => r2(R.days.get(d) ?? 0) !== r2(S.days.get(d) ?? 0))
    .map((d) => `${d}:${R.days.get(d) ?? "-"}/${S.days.get(d) ?? "-"}`);
  const rec = { code, R, S, diff: r2(S.total - R.total), dd };
  out.push([code, R.total || "", S.total || "", rec.diff || "", dd.join(" "), [...R.labels].join(", ")]);
  if (!R.total) onlySys.push(rec);
  else if (!S.total) onlyReport.push(rec);
  else if (rec.diff === 0 && !dd.length) agree.push(rec);
  else differ.push(rec);
}

// ----------------------------------------------------------------- output
const pad = (s, n) => String(s).padEnd(n);
const sec = (t, list, showDays) => {
  if (!list.length) return;
  console.log(`\n  ${t}  (${list.length})`);
  for (const r of list) {
    console.log(`    ${pad(r.code, 14)}${pad(r.R.total || "\u2014", 10)}${pad(r.S.total || "\u2014", 10)}` +
      pad(r.diff ? `${r.diff > 0 ? "+" : ""}${r.diff}` : (r.dd.length ? "same total" : "match"), 12) +
      (showDays && r.dd.length ? `days ${r.dd.slice(0, 8).join(" ")}${r.dd.length > 8 ? " ..." : ""}` : ""));
  }
};

console.log(`\n=== CEP/03 Galagedara, ${TAB} ${YM} — Monthly Consumption Report vs system ===`);
console.log(`    report : ${BOOK.split("/").pop()}  [${TAB}]`);
console.log(`    system : fuel drawn from the Galagedara tank\n`);
console.log(`    ${pad("machine", 14)}${pad("REPORT", 10)}${pad("SYSTEM", 10)}${pad("diff", 12)}`);
sec("AGREE — same total AND same day-by-day", agree, false);
sec("DIFFER", differ, true);
sec("IN THE REPORT, NOT IN THE SYSTEM", onlyReport, true);
sec("IN THE SYSTEM, NOT IN THE REPORT", onlySys, true);

console.log(`\n  ${"-".repeat(62)}`);
console.log(`  report, machines only            : ${r2(rt)} L`);
if (transfers.length) {
  console.log(`  report, NOT machine fuel         :`);
  for (const t of transfers) console.log(`      row ${t.row}  ${pad(t.label.slice(0, 38), 40)}${t.litres} L${t.note ? "  <- " + t.note : ""}`);
  console.log(`                                     ${r2(transfers.reduce((s, t) => s + t.litres, 0))} L`);
}
console.log(`  report, everything               : ${r2(rt + transfers.reduce((s, t) => s + t.litres, 0))} L`);
console.log(`  system, Galagedara tank          : ${r2(st)} L`);
console.log(`  gap on machines                  : ${r2(st - rt) > 0 ? "+" : ""}${r2(st - rt)} L`);

console.log(`\n  the sheet's own summary lines:`);
for (const b of blockTotals) console.log(`      row ${b.row}  ${pad(b.label.slice(0, 40), 42)}${b.litres}`);
for (const [k, v] of Object.entries(stated)) console.log(`      ${pad(k, 48)}${v}`);

const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(out), `${TAB} vs system`);
X.writeFile(wb, OUT);
console.log(`\n  written: ${OUT}\n`);
db.close();
