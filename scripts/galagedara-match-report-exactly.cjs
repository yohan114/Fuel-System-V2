// Bring HEX-23 and HEX-26 into line with the site's Monthly Fuel Consumption
// Report, at the owner's direction.
//
//     node scripts/galagedara-match-report-exactly.cjs
//     node scripts/galagedara-match-report-exactly.cjs --apply
//     DB=/var/lib/fuel-system/app.db node scripts/galagedara-match-report-exactly.cjs --apply
//
// READ THIS BEFORE RE-RUNNING OR REVERSING IT.
//
// These two changes make the database DISAGREE with the site's own daily issue
// sheets. That is deliberate and was decided by the system's owner on 3 Sep
// 2026, after the evidence below was put in front of them. It is recorded here
// and in the audit log so that nobody later "corrects" the database back and
// wonders why the total moved.
//
// The report totals HEX-23 at 812 L and HEX-26 at 2,509 L. The system held 742
// and 2,599. Each gap is one row.
//
// HEX-23, 26 August. The system holds 60 L, the report 130 L. The 26/08/26
// sheet row 04 reads "HEX-23 | 124(struck) | 130 | 124 | (60)" across
// Qty / Current Meter / Previous Meter / Consumption: the operator wrote the
// previous meter into the quantity box, struck it, and circled 60. Three things
// say 130 is the meter and not litres — the 25 Aug reading is 124 (the sheet's
// own "Previous"), the 27/08 sheet reads "Previous: 130", and 60 L across the
// 6.0 hours from 124 to 130 is 10.0 L/h against this machine's 5-12 L/h all
// month, where 130 L would be 21.7 L/h. Setting it to 130 books a meter reading
// as fuel.
//
// HEX-26, 19 August. The system holds two fills, the report one of 150 L. The
// 19/08/26 sheet lists the machine on two separate lines — row 01, 50 L,
// 10497.1 -> 10501.0, and row 13, 190 L, 10501.0 -> 10507.5 — and the meter
// chain runs unbroken through both, so both fills happened. The report's 150 is
// the figure from row 05 of the same sheet, which is HEX-37; the report's own
// HEX-37 cell also reads 150. Matching it means removing 90 L that two meter
// readings account for.
//
// HOW HEX-26 IS MATCHED. The 50 L row is voided and the 190 L row set to 150,
// leaving one row of 150 L as the report shows, rather than two rows summing to
// it. The surviving row keeps meter 10507.5, so the chain stays monotonic
// (10497.1 on 14 Aug -> 10507.5 on 19 Aug). The voided row is voided, not
// deleted: its meter reading of 10501.0 stays on file and the row can be
// brought back.
//
// TANK BALANCES are not touched, for the same reason as everywhere else in this
// reconciliation: these rows arrived through importers that never wrote to
// BulkTank.balance, so there is no balance to correct.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const fs = require("node:fs");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
if (!fs.existsSync(DB_PATH)) {
  console.error(`\nno database at ${DB_PATH}\n  cwd is ${process.cwd()}\n`);
  process.exit(2);
}

const SITE = "CEP-03F";
const DIRECTION =
  "Set at the owner's direction on 2026-09-03 to match the site's Monthly Fuel Consumption Report. " +
  "The site's own daily issue sheet says otherwise and the sheet was not found to be in error.";

const db = new Database(DB_PATH);
const rs = (c) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

console.log(`\n=== Match the report exactly (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
if (!admin) throw new Error("no ADMIN user to attribute these changes to");

const rowsOn = (code, ymd) => db.prepare(`
  SELECT f.* FROM FuelIssue f JOIN Asset a ON a.id=f.assetId
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE p.code=? AND f.voided=0 AND a.code=?
    AND date(f.issueDate,'+5 hours','+30 minutes')=?
  ORDER BY f.litres`).all(SITE, code, ymd);

const total = (code) => db.prepare(`
  SELECT ROUND(SUM(f.litres),2) L FROM FuelIssue f JOIN Asset a ON a.id=f.assetId
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE p.code=? AND f.voided=0 AND a.code=?
    AND f.issueDate >= '2026-07-31T18:30:00.000+00:00'
    AND f.issueDate <  '2026-08-31T18:30:00.000+00:00'`).get(SITE, code).L;

const ops = [];
const skipped = [];

// ---- HEX-23, 26 August: 60 -> 130 -----------------------------------------
{
  const rows = rowsOn("HEX-23", "2026-08-26");
  const hit = rows.filter((r) => r.litres === 60);
  if (hit.length !== 1) skipped.push(["HEX-23 26 Aug", `expected one live 60 L row, found ${hit.length}`]);
  else ops.push({ kind: "edit", row: hit[0], code: "HEX-23", ymd: "2026-08-26", to: 130,
    why: "report shows 130; the sheet's 130 is the Current Meter and its circled quantity is 60" });
}

// ---- HEX-26, 19 August: two fills (50 + 190) -> one of 150 -----------------
{
  const rows = rowsOn("HEX-26", "2026-08-19");
  const small = rows.filter((r) => r.litres === 50);
  const large = rows.filter((r) => r.litres === 190);
  if (small.length !== 1 || large.length !== 1) {
    skipped.push(["HEX-26 19 Aug", `expected one 50 L and one 190 L row, found ${small.length} and ${large.length}`]);
  } else {
    ops.push({ kind: "void", row: small[0], code: "HEX-26", ymd: "2026-08-19",
      why: "report shows a single 19 Aug fill; this is the first of the two the sheet records" });
    ops.push({ kind: "edit", row: large[0], code: "HEX-26", ymd: "2026-08-19", to: 150,
      why: "report shows 150 for the day; the sheet records 50 + 190 = 240" });
  }
}

for (const o of ops) {
  const line = o.kind === "edit"
    ? `${o.code.padEnd(9)}${o.ymd}  ${String(o.row.litres).padStart(5)} -> ${String(o.to).padEnd(5)} (${o.to - o.row.litres > 0 ? "+" : ""}${o.to - o.row.litres} L)`
    : `${o.code.padEnd(9)}${o.ymd}  VOID ${String(o.row.litres).padStart(4)} L            `;
  console.log(`  ${line}  meter ${String(o.row.meterReading ?? "-").padEnd(9)} ${o.why}`);
}
if (skipped.length) {
  console.log("\n  SKIPPED:");
  for (const [w, why] of skipped) console.log(`    ${w.padEnd(18)}${why}`);
}

const delta = ops.reduce((s, o) => s + (o.kind === "edit" ? o.to - o.row.litres : -o.row.litres), 0);
console.log(`\n  HEX-23 now ${total("HEX-23")} L  -> report says 812`);
console.log(`  HEX-26 now ${total("HEX-26")} L  -> report says 2509`);
console.log(`  net change: ${delta > 0 ? "+" : ""}${delta} L`);

if (!APPLY) {
  console.log("\nDRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

const now = new Date().toISOString().replace("Z", "+00:00");
db.transaction(() => {
  for (const o of ops) {
    let summary;
    if (o.kind === "edit") {
      db.prepare("UPDATE FuelIssue SET litres=?, totalCost=? WHERE id=?")
        .run(o.to, Math.round(o.to * o.row.pricePerLitre), o.row.id);
      summary = `${o.code} ${o.ymd}: ${o.row.litres} L -> ${o.to} L (${rs(Math.round(o.to * o.row.pricePerLitre))}). ${o.why}. ${DIRECTION}`;
    } else {
      db.prepare("UPDATE FuelIssue SET voided=1, voidedAt=? WHERE id=?").run(now, o.row.id);
      summary = `${o.code} ${o.ymd}: voided ${o.row.litres} L (meter ${o.row.meterReading ?? "none"}). ${o.why}. ` +
        `Voided rather than deleted, so the meter reading stays on file and the row can be restored. ${DIRECTION}`;
    }
    db.prepare(`INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), admin.id, "UPDATE", "FuelIssue", o.row.id, summary, now);
  }
})();

db.pragma("wal_checkpoint(TRUNCATE)");

const tank = db.prepare(`
  SELECT COUNT(*) n, ROUND(SUM(f.litres),2) L FROM FuelIssue f
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE p.code=? AND f.voided=0
    AND f.issueDate >= '2026-07-31T18:30:00.000+00:00'
    AND f.issueDate <  '2026-08-31T18:30:00.000+00:00'`).get(SITE);
const tr = db.prepare(`SELECT ROUND(SUM(requestedLitres),2) L FROM BulkRequest
  WHERE sourceType='TANK' AND sourceTankId=(SELECT t.id FROM BulkTank t JOIN Project p ON p.id=t.projectId WHERE p.code=?)`).get(SITE).L ?? 0;

console.log(`\n  DONE.`);
console.log(`  HEX-23 : ${total("HEX-23")} L`);
console.log(`  HEX-26 : ${total("HEX-26")} L`);
console.log(`  Galagedara August: ${tank.n} issues, ${tank.L} L machine fuel + ${tr} L transferred = ${Math.round((tank.L + tr) * 100) / 100} L out of the tank\n`);
db.close();
