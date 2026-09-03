// Undo the Batticaloa site postings that the misfiled 8 August day sheet created.
//
//     node scripts/fix-galagedara-assignments.cjs                 # dry run
//     node scripts/fix-galagedara-assignments.cjs --apply
//
// WHY THIS IS SEPARATE FROM MOVING THE FUEL. Billing does not follow the tank,
// it follows the machine's site assignment on the day (src/lib/billing/usage.ts:
// "Fuel follows the vehicle"). So re-filing the 8 August rows onto the Galagedara
// tank fixed the fuel report and left the MONEY in Batticaloa: 686 of the 736 L
// still posted to BATTI-02 afterwards. This closes that.
//
// WHAT THE BAD IMPORT DID. For each machine on the misfiled sheet it drove a
// one-day wedge into a continuous Galagedara posting — closing CEP-03F early,
// opening a BATTI-02 span for 8 August, then reopening CEP-03F the next day.
// Undoing it means deleting the wedge and closing the gap it left behind.
//
// GTE-84 IS NOT TOUCHED. It also holds an open-ended BATTI-02 posting from the
// same import run, but its 5 L on 8 August is on Lot-02's OWN tab, not the
// misfiled one. It is Lot-02's machine and its posting is correct.
//
// Two machines cannot be repaired by closing a gap and are handled by name:
//   SC-14  the wedge is open-ended and the span before it is a genuine one-day
//          Wadakada posting, so extending that would post a Galagedara machine
//          (187 L there in August) to Wadakada for good. It gets an explicit
//          CEP-03F span instead.
//   MG-04  the wedge is open-ended and was created by a row that was never
//          MG-04's — the sheet's "MG-04" is MG-07, proven by the meter chain
//          10820.8 -> 10826.5 -> 10831.8 -> 10837.8 -> 10848.5. MG-04 has no
//          August fuel at all and its last fill was 29 January at Mihintale.
//          The wedge is deleted and NOT replaced: inventing a posting would
//          start billing an idle grader at a site on no evidence. It is left
//          unassigned and reported, for a human to place.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";

// The machines whose 8 August fuel came off the misfiled Galagedara issue note.
const WEDGED = ["325-1030", "DT-56", "DT-58", "DT-67", "DT-79", "HEX-26", "HEX-33",
  "HEX-37", "HEX-42", "HEX-45", "MG-04", "SC-14", "SR-12", "SR-13", "ZB-4606"];
const LEAVE_UNASSIGNED = new Set(["MG-04"]);
const EXPLICIT = { "SC-14": "CEP-03F" };

const db = new Database(DB_PATH);
const dayBefore = (iso) => new Date(new Date(iso).getTime() - 86400000).toISOString().replace("Z", "+00:00");

console.log(`\n=== Batticaloa wedge removal (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
const cepF = db.prepare("SELECT id FROM Project WHERE code='CEP-03F'").get();

// How the 8 August fuel on the Galagedara tank resolves for billing, before.
const resolve = () => db.prepare(`
  SELECT p.code, COUNT(*) n, ROUND(SUM(f.litres),2) L
  FROM FuelIssue f
  JOIN AssetAssignment g ON g.assetId=f.assetId AND g.startDate<=f.issueDate
    AND (g.endDate IS NULL OR g.endDate>=f.issueDate)
  JOIN Project p ON p.id=g.projectId
  WHERE f.voided=0 AND date(f.issueDate,'+5 hours','+30 minutes')='2026-08-08'
    AND f.bulkTankId=(SELECT t.id FROM BulkTank t JOIN Project pp ON pp.id=t.projectId WHERE pp.code='CEP-03F')
  GROUP BY p.code`).all();

console.log("  8 August fuel on the Galagedara tank bills to:");
for (const r of resolve()) console.log(`    ${r.code.padEnd(10)}${r.n} rows, ${r.L} L`);
console.log("");

const ops = [];
const skipped = [];

for (const code of WEDGED) {
  const asset = db.prepare("SELECT id, code FROM Asset WHERE code=?").get(code);
  if (!asset) { skipped.push([code, "no such asset"]); continue; }

  const wedge = db.prepare(`
    SELECT g.id, g.startDate, g.endDate FROM AssetAssignment g
    JOIN Project p ON p.id=g.projectId
    WHERE g.assetId=? AND p.code='BATTI-02' AND g.origin='FUEL'
      AND date(g.startDate,'+5 hours','+30 minutes')='2026-08-08'`).all(asset.id);
  if (wedge.length !== 1) { skipped.push([code, `expected 1 Batticaloa wedge, found ${wedge.length}`]); continue; }
  const w = wedge[0];

  // Nothing may be deleted while it still carries fuel of its own. The 8 August
  // rows have already moved to the Galagedara tank, so a machine that still has
  // Batticaloa fuel inside this span genuinely belongs there.
  const held = db.prepare(`
    SELECT COUNT(*) n FROM FuelIssue f
    JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
    WHERE f.assetId=? AND f.voided=0 AND p.code='BATTI-02'
      AND f.issueDate>=? AND (? IS NULL OR f.issueDate<=?)`).get(asset.id, w.startDate, w.endDate, w.endDate).n;
  if (held) { skipped.push([code, `still holds ${held} Batticaloa fuel row(s) inside this span — refusing`]); continue; }

  const prev = db.prepare(`SELECT g.id, g.endDate, p.code FROM AssetAssignment g JOIN Project p ON p.id=g.projectId
    WHERE g.assetId=? AND g.startDate < ? ORDER BY g.startDate DESC LIMIT 1`).get(asset.id, w.startDate);
  const next = db.prepare(`SELECT g.id, g.startDate, p.code FROM AssetAssignment g JOIN Project p ON p.id=g.projectId
    WHERE g.assetId=? AND g.startDate > ? ORDER BY g.startDate ASC LIMIT 1`).get(asset.id, w.startDate);

  if (LEAVE_UNASSIGNED.has(code)) {
    ops.push({ code, assetId: asset.id, wedge: w, action: "delete-only", prev, next });
  } else if (EXPLICIT[code]) {
    ops.push({ code, assetId: asset.id, wedge: w, action: "replace", prev, next, site: EXPLICIT[code] });
  } else if (prev && next) {
    ops.push({ code, assetId: asset.id, wedge: w, action: "close-gap", prev, next, newEnd: dayBefore(next.startDate) });
  } else if (prev && !next) {
    ops.push({ code, assetId: asset.id, wedge: w, action: "reopen", prev, next, newEnd: null });
  } else {
    skipped.push([code, "no assignment before the wedge — cannot close the gap safely"]);
  }
}

for (const o of ops) {
  const span = `${String(o.wedge.startDate).slice(0, 10)} -> ${o.wedge.endDate ? String(o.wedge.endDate).slice(0, 10) : "OPEN"}`;
  let what;
  if (o.action === "close-gap") what = `delete wedge, extend ${o.prev.code} to ${String(o.newEnd).slice(0, 10)} (next: ${o.next.code} ${String(o.next.startDate).slice(0, 10)})`;
  else if (o.action === "reopen") what = `delete wedge, reopen ${o.prev.code} (no later posting)`;
  else if (o.action === "replace") what = `delete wedge, open ${o.site} from ${String(o.wedge.startDate).slice(0, 10)} (prev was ${o.prev ? o.prev.code : "none"}, one day only)`;
  else what = `delete wedge, leave UNASSIGNED — no August fuel, last fill 29 Jan at Mihintale`;
  console.log(`  ${o.code.padEnd(10)}BATTI-02[${span}]  ${what}`);
}
if (skipped.length) {
  console.log("\n  SKIPPED:");
  for (const [c, why] of skipped) console.log(`    ${c.padEnd(11)}${why}`);
}

console.log(`\n  ${ops.length} wedges to remove, ${skipped.length} skipped\n`);

if (!APPLY) {
  console.log("DRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

const now = new Date().toISOString().replace("Z", "+00:00");
const audit = (id, summary) => db.prepare(
  `INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
  .run(randomUUID(), admin.id, "UPDATE", "AssetAssignment", id, summary, now);

const WHY = "Created by the import that read Lot-02's stray \"08-08-2026 (Issue Note)\" tab, which holds " +
  "Galagedara's 8 August issue note (15 rows, 736 L). The fuel has been re-filed to the Galagedara tank; " +
  "this removes the Batticaloa site posting that came with it, which was still billing 686 L to BATTI-02.";

db.transaction(() => {
  for (const o of ops) {
    db.prepare("DELETE FROM AssetAssignment WHERE id=?").run(o.wedge.id);
    audit(o.wedge.id, `Deleted Batticaloa posting for ${o.code} covering 2026-08-08. ${WHY}`);

    if (o.action === "close-gap" || o.action === "reopen") {
      db.prepare("UPDATE AssetAssignment SET endDate=?, updatedAt=? WHERE id=?").run(o.newEnd, now, o.prev.id);
      audit(o.prev.id, `Extended ${o.prev.code} posting for ${o.code} to ${o.newEnd ? String(o.newEnd).slice(0, 10) : "open-ended"}, ` +
        `closing the one-day gap left by the deleted Batticaloa posting. ${WHY}`);
    } else if (o.action === "replace") {
      const id = randomUUID();
      db.prepare(`INSERT INTO AssetAssignment (id,assetId,projectId,startDate,endDate,note,billingType,createdAt,updatedAt,createdById,origin)
                  VALUES (?,?,?,?,NULL,?,?,?,?,?,?)`).run(
        id, o.assetId, cepF.id, o.wedge.startDate,
        `Restored after the misfiled 8 August day sheet. ${o.code} drew 187 L from the Galagedara tank in August.`,
        "STANDARD", now, now, admin.id, "FUEL");
      audit(id, `Opened CEP-03F posting for ${o.code} from ${String(o.wedge.startDate).slice(0, 10)}. The deleted Batticaloa ` +
        `posting was open-ended and the span before it was a genuine one-day Wadakada posting, so extending that ` +
        `would have billed a Galagedara machine to Wadakada indefinitely. ${WHY}`);
    } else {
      audit(o.wedge.id, `${o.code} deliberately left UNASSIGNED after 2026-08-06. The sheet's "MG-04" row is MG-07 ` +
        `(meter chain 10820.8 -> 10826.5 -> 10831.8 -> 10837.8 -> 10848.5), so this posting rested on a row that was ` +
        `never MG-04's. MG-04 has no August fuel and last filled on 29 January at Mihintale. A replacement posting is ` +
        `NOT invented here: that would start billing an idle grader to a site on no evidence. Place it by hand.`);
    }
  }
})();

db.pragma("wal_checkpoint(TRUNCATE)");

console.log("  8 August fuel on the Galagedara tank now bills to:");
for (const r of resolve()) console.log(`    ${r.code.padEnd(10)}${r.n} rows, ${r.L} L`);
console.log("\n  Re-generate the August drafts for BOTH CEP-03F and BATTI-02.\n");
db.close();
