// Before overwriting one database with another, find out what the target holds
// that the replacement does not.
//
//     node scripts/compare-before-overwrite.cjs <target.db> <replacement.db>
//
//     node scripts/compare-before-overwrite.cjs \
//       "D:/Fuel system server side/backups/vps-latest.db" \
//       "D:/Fuel system server side/fuelsystem/data/app.db"
//
// Exits 0 when the overwrite loses nothing, 1 when it would.
//
// WHY THIS EXISTS. Shipping a database up to the server replaces it wholesale.
// Anything typed into the live system between the backup coming down and the
// copy going up disappears, and nothing anywhere reports that it happened — the
// row counts still look plausible and the app still starts. Twenty hand-entered
// fuel issues were lost that way on this project.
//
// WHAT IT COUNTS AS A LOSS. Only rows the target has that the replacement does
// not. An imported row that both sides derived from the same spreadsheet is not
// a loss even when its id differs, so rows are matched on WHAT THEY SAY —
// machine, day, litres, tank — not on their primary key. Hand-entered rows
// (importKey IS NULL) are reported separately and loudly, because those exist
// nowhere else: a lost import can be re-run from the workbook, a lost pump
// entry is gone.
//
// A row this reports is not necessarily a reason to abandon the overwrite. It
// is a reason to look, and to carry those rows across deliberately rather than
// discover their absence in a month.

const Database = require("better-sqlite3");

const [targetPath, replacementPath] = process.argv.slice(2);
if (!targetPath || !replacementPath) {
  console.error("usage: node scripts/compare-before-overwrite.cjs <target.db> <replacement.db>");
  console.error("  target      = the database about to be OVERWRITTEN (usually the server's)");
  console.error("  replacement = the database about to be SHIPPED (usually yours)");
  process.exit(2);
}

const open = (p, label) => {
  let db;
  try { db = new Database(p, { readonly: true }); } catch (err) {
    console.error(`cannot open ${label} (${p}): ${err.message}`); process.exit(2);
  }
  try { db.pragma("integrity_check"); } catch (err) {
    console.error(`${label} is not a readable database (${p}): ${err.message}`); process.exit(2);
  }
  return db;
};

const A = open(targetPath, "target");
const B = open(replacementPath, "replacement");

const day = "date(f.issueDate,'+5 hours','+30 minutes')";
const ISSUES = `
  SELECT f.id, f.importKey, f.litres, f.createdAt, f.source,
         ${day} d, a.code machine, COALESCE(p.code,'(no tank)') site
  FROM FuelIssue f
  JOIN Asset a ON a.id = f.assetId
  LEFT JOIN BulkTank t ON t.id = f.bulkTankId
  LEFT JOIN Project p ON p.id = t.projectId
  WHERE f.voided = 0`;

// Identity is what the row SAYS, not its id — the same fill imported twice on
// two machines gets two different uuids and is still one fill.
const key = (r) => `${r.d}|${r.machine}|${r.litres}|${r.site}`;

const load = (db) => {
  const m = new Map();
  for (const r of db.prepare(ISSUES).all()) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

const inA = load(A);
const inB = load(B);

// Multiset difference: two identical fills on one day are two fills, so compare
// counts per key rather than mere presence.
const onlyInTarget = [];
for (const [k, rows] of inA) {
  const have = inB.get(k)?.length ?? 0;
  if (rows.length > have) onlyInTarget.push(...rows.slice(have));
}
let extraInReplacement = 0;
for (const [k, rows] of inB) {
  const have = inA.get(k)?.length ?? 0;
  if (rows.length > have) extraInReplacement += rows.length - have;
}

const nA = A.prepare("SELECT COUNT(*) n FROM FuelIssue WHERE voided=0").get().n;
const nB = B.prepare("SELECT COUNT(*) n FROM FuelIssue WHERE voided=0").get().n;
const latest = (db) => db.prepare("SELECT MAX(issueDate) m FROM FuelIssue WHERE voided=0").get().m;
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }) : "none");

console.log(`\n=== What the overwrite would cost ===\n`);
console.log(`  TARGET      (to be overwritten) ${targetPath}`);
console.log(`              ${nA} live issues, latest ${fmt(latest(A))}`);
console.log(`  REPLACEMENT (to be shipped)     ${replacementPath}`);
console.log(`              ${nB} live issues, latest ${fmt(latest(B))}\n`);

const handMade = onlyInTarget.filter((r) => !r.importKey);
const imported = onlyInTarget.filter((r) => r.importKey);

if (!onlyInTarget.length) {
  console.log(`  Nothing on the target is absent from the replacement.`);
  console.log(`  The replacement additionally holds ${extraInReplacement} issue(s) the target does not.`);
  console.log(`\n  SAFE TO OVERWRITE.\n`);
  A.close(); B.close();
  process.exit(0);
}

console.log(`  ${onlyInTarget.length} live issue(s) exist on the TARGET and not in the REPLACEMENT.`);
console.log(`  Overwriting destroys them.\n`);

const table = (rows, title) => {
  if (!rows.length) return;
  console.log(`  ${title} (${rows.length}, ${Math.round(rows.reduce((s, r) => s + r.litres, 0) * 100) / 100} L)`);
  for (const r of rows.slice(0, 40)) {
    console.log(`    ${r.d}  ${String(r.machine).padEnd(12)}${String(r.litres).padStart(7)} L  ${String(r.site).padEnd(10)}` +
      `entered ${String(r.createdAt).slice(0, 10)}  ${String(r.source ?? "").slice(0, 32)}`);
  }
  if (rows.length > 40) console.log(`    ... and ${rows.length - 40} more`);
  console.log("");
};

table(handMade, "TYPED IN BY HAND — these exist nowhere else");
table(imported, "IMPORTED — re-runnable from the source workbook if lost");

console.log(`  ${extraInReplacement} issue(s) in the replacement are absent from the target (your new work).\n`);
console.log(`  DO NOT OVERWRITE until the hand-entered rows above are accounted for.`);
console.log(`  Either carry them across first, or re-apply your changes on top of a fresh`);
console.log(`  copy of the target instead of shipping this one up.\n`);

A.close(); B.close();
process.exit(1);
