// One cab, two asset records, and 171 L billed to the wrong site.
//
//     node scripts/fix-41-7225.cjs
//     node scripts/fix-41-7225.cjs --apply
//     DB=/var/lib/fuel-system/app.db node scripts/fix-41-7225.cjs --apply
//
// WHICH PLATE IS REAL. 41-7225. The site settled it themselves on paper: the
// 09/08/26 daily sheet, row 15, reads "41-4225 | 46 | 281008" with "(41-7225)"
// CIRCLED in the Consumption column — the same circled-correction convention
// this site uses for quantities. The 12/08 sheet row 27 and the 27/08 sheet row
// 07 both write 41-7225 plainly, and the Monthly Fuel Consumption Report lists a
// single "41-7225 | TO Cab | 251", which is exactly the two records added
// together (171 + 80). No document anywhere writes 41-4225 uncorrected.
//
// An audit entry dated 14 August reads "Renamed LA-4225 to 41-4225 — the
// Galagedara workbook recorded the plate both ways and 41-4225 is the correct
// one". That decision was made from the workbook transcription and went the
// wrong way; the daily sheet the workbook was typed from says otherwise.
//
// THE PART THAT ACTUALLY COSTS MONEY. Merging the fuel is not enough and doing
// only that makes things worse. Billing follows the machine's site posting, not
// the tank. 41-7225's only posting is BGP (Badalgama) from 24 July, open-ended,
// created by a single workshop fill on the 25th — so its five later fills, all
// drawn from the GALAGEDARA tank, are charged to Badalgama. 171 L in the wrong
// place. The two rows under 41-4225 bill correctly only by accident, because
// that throwaway asset happens to carry a CEP-03F posting.
//
// So the Galagedara posting moves across with the fuel and Badalgama's is closed
// the day before it starts. The cab really was at Badalgama in July — that fill
// and that posting are correct and stay.
//
// NOTHING IS DELETED. 41-4225 is marked DISPOSED with its history intact, so
// the rename can be traced. Tank balances are untouched: this moves rows between
// machines, and not one litre enters or leaves a tank.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const fs = require("node:fs");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
if (!fs.existsSync(DB_PATH)) {
  console.error(`\nno database at ${DB_PATH}\n  cwd is ${process.cwd()}\n`);
  process.exit(2);
}

const KEEP = "41-7225";  // the plate the site circled
const DROP = "41-4225";  // the record created from the uncorrected reading

const db = new Database(DB_PATH);
const day = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const dayBefore = (iso) => new Date(new Date(iso).getTime() - 86400000).toISOString().replace("Z", "+00:00");

console.log(`\n=== ${DROP} -> ${KEEP} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
const keep = db.prepare("SELECT * FROM Asset WHERE code=?").get(KEEP);
const drop = db.prepare("SELECT * FROM Asset WHERE code=?").get(DROP);
if (!keep) throw new Error(`${KEEP} does not exist`);
if (!drop) { console.log(`  ${DROP} no longer exists — nothing to merge.\n`); db.close(); process.exit(0); }

// Where things stand, per fuel row, before anything moves.
const billing = () => db.prepare(`
  SELECT a.code machine, date(f.issueDate,'+5 hours','+30 minutes') d, f.litres,
         COALESCE(tp.code,'-') tank, COALESCE(bp.code,'UNASSIGNED') bills
  FROM FuelIssue f
  JOIN Asset a ON a.id=f.assetId
  LEFT JOIN BulkTank t ON t.id=f.bulkTankId
  LEFT JOIN Project tp ON tp.id=t.projectId
  LEFT JOIN AssetAssignment g ON g.assetId=f.assetId AND g.startDate<=f.issueDate
       AND (g.endDate IS NULL OR g.endDate>=f.issueDate)
  LEFT JOIN Project bp ON bp.id=g.projectId
  WHERE a.code IN (?,?) AND f.voided=0 ORDER BY f.issueDate`).all(KEEP, DROP);

const show = (rows, title) => {
  console.log(`  ${title}`);
  for (const r of rows) {
    const wrong = r.tank !== "-" && r.bills !== "UNASSIGNED" && r.tank !== r.bills;
    console.log(`    ${r.d}  ${r.machine.padEnd(9)}${String(r.litres).padStart(4)} L  tank ${r.tank.padEnd(9)} bills ${r.bills.padEnd(11)}${wrong ? "<-- wrong site" : ""}`);
  }
};
show(billing(), "before:");

const fuel = db.prepare("SELECT id, litres, issueDate FROM FuelIssue WHERE assetId=?").all(drop.id);
const meters = db.prepare("SELECT id, value, readingType, readingDate FROM MeterReading WHERE assetId=?").all(drop.id);
const assign = db.prepare("SELECT * FROM AssetAssignment WHERE assetId=?").all(drop.id);
const bgp = db.prepare(`SELECT g.* FROM AssetAssignment g JOIN Project p ON p.id=g.projectId
  WHERE g.assetId=? AND p.code='BGP'`).get(keep.id);

const cepf = assign.find((g) => {
  const p = db.prepare("SELECT code FROM Project WHERE id=?").get(g.projectId);
  return p && p.code === "CEP-03F";
});

console.log(`\n  plan:`);
console.log(`    ${fuel.length} fuel row(s)      ${DROP} -> ${KEEP}   (${fuel.map((f) => f.litres + "L " + day(f.issueDate)).join(", ")})`);
console.log(`    ${meters.length} meter reading(s) ${DROP} -> ${KEEP}   (${meters.map((m) => m.value + " " + m.readingType + " " + day(m.readingDate)).join(", ")})`);
if (cepf) console.log(`    CEP-03F posting   ${DROP} -> ${KEEP}   from ${day(cepf.startDate)}, open-ended`);
if (bgp && cepf) console.log(`    BGP posting       closed at ${day(dayBefore(cepf.startDate))} (it runs open-ended today, which is why ${KEEP}'s Galagedara fuel bills to Badalgama)`);
console.log(`    ${KEEP} regNo       ${keep.regNo ?? "(none)"} -> ${KEEP}`);
console.log(`    ${DROP}           marked DISPOSED, history kept`);

const otherRefs = [];
for (const t of ["ServiceRecord", "FuelRequest", "BillLineItem", "VehicleAllocation", "DailyCondition", "TankDip"]) {
  try { const n = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE assetId=?`).get(drop.id).n; if (n) otherRefs.push(`${t}:${n}`); } catch { /* table has no assetId */ }
}
if (otherRefs.length) console.log(`\n  OTHER REFERENCES to ${DROP} that this does NOT move: ${otherRefs.join(", ")}`);

if (!APPLY) {
  console.log("\nDRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

const now = new Date().toISOString().replace("Z", "+00:00");
const WHY = `The 09/08/26 daily sheet row 15 reads "${DROP} | 46 | 281008" with "(${KEEP})" circled in the ` +
  `Consumption column — the site's own correction. The 12/08 and 27/08 sheets write ${KEEP} plainly, and the ` +
  `Monthly Fuel Consumption Report lists one "${KEEP} | TO Cab | 251", which is both records added together. ` +
  `The 14 Aug rename of LA-4225 to ${DROP} was made from the workbook transcription and went the wrong way.`;
const audit = (entity, id, summary) => db.prepare(
  `INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
  .run(randomUUID(), admin.id, "UPDATE", entity, id, summary, now);

db.transaction(() => {
  for (const f of fuel) {
    db.prepare("UPDATE FuelIssue SET assetId=? WHERE id=?").run(keep.id, f.id);
    audit("FuelIssue", f.id, `Moved ${f.litres} L on ${day(f.issueDate)} from ${DROP} to ${KEEP}. ${WHY} No tank was touched.`);
  }
  for (const m of meters) {
    db.prepare("UPDATE MeterReading SET assetId=? WHERE id=?").run(keep.id, m.id);
    audit("MeterReading", m.id, `Moved reading ${m.value} ${m.readingType} of ${day(m.readingDate)} from ${DROP} to ${KEEP}. ${WHY}`);
  }
  if (cepf) {
    db.prepare("UPDATE AssetAssignment SET assetId=?, updatedAt=?, note=? WHERE id=?")
      .run(keep.id, now, `Galagedara posting, moved from ${DROP} when the two records were merged. ${KEEP} has drawn from the Galagedara tank since 9 August.`, cepf.id);
    audit("AssetAssignment", cepf.id, `Moved the CEP-03F posting from ${DROP} to ${KEEP}, effective ${day(cepf.startDate)}. ${WHY}`);
    if (bgp && !bgp.endDate) {
      const end = dayBefore(cepf.startDate);
      db.prepare("UPDATE AssetAssignment SET endDate=?, updatedAt=? WHERE id=?").run(end, now, bgp.id);
      audit("AssetAssignment", bgp.id,
        `Closed ${KEEP}'s Badalgama posting at ${day(end)}. It was open-ended from 24 July on the strength of one ` +
        `workshop fill, so five later fills drawn from the GALAGEDARA tank were being charged to Badalgama — 171 L ` +
        `at the wrong site. The July fill and this posting up to that date are correct and stay. ${WHY}`);
    }
  }
  if (!keep.regNo) {
    db.prepare("UPDATE Asset SET regNo=?, updatedAt=? WHERE id=?").run(KEEP, now, keep.id);
    audit("Asset", keep.id, `Set registration to ${KEEP}; it had none, which is why the importer could not match the daily sheets to it and created ${DROP} instead. ${WHY}`);
  }
  db.prepare("UPDATE Asset SET status='DISPOSED', typeLabel=?, updatedAt=? WHERE id=?")
    .run(`MERGED into ${KEEP} on 2026-09-03 — created from an uncorrected plate reading, not a real machine`, now, drop.id);
  audit("Asset", drop.id, `Marked DISPOSED and merged into ${KEEP}. Kept rather than deleted so the rename can be traced. ${WHY}`);
})();

db.pragma("wal_checkpoint(TRUNCATE)");

console.log("");
show(billing(), "after:");

const F = "2026-07-31T18:30:00.000+00:00", T = "2026-08-31T18:30:00.000+00:00";
console.log("\n  August fuel billed to each site, for the two sites this moves:");
for (const code of ["CEP-03F", "BGP"]) {
  const r = db.prepare(`
    SELECT COUNT(*) n, ROUND(SUM(f.litres),1) L FROM FuelIssue f
    JOIN AssetAssignment g ON g.assetId=f.assetId AND g.startDate<=f.issueDate
      AND (g.endDate IS NULL OR g.endDate>=f.issueDate)
    JOIN Project p ON p.id=g.projectId
    WHERE p.code=? AND f.voided=0 AND f.issueDate>=? AND f.issueDate<?`).get(code, F, T);
  console.log(`    ${code.padEnd(9)}${r.n} issues, ${r.L} L`);
}
console.log(`\n  The Galagedara TANK total is unchanged — every one of these fills was already on it.`);
console.log(`  Regenerate August drafts for CEP-03F and BGP.\n`);
db.close();
