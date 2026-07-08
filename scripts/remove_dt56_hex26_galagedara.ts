import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Remove DT-56 and HEX-26 from CEP-03F Galagedara entirely: their (draft) bills,
// site assignments, Galagedara-tank fuel issues and the site pin. The fuel they
// held (170 L) is returned to the tank balance. These two only ever brushed the
// site and are billed elsewhere, so they should not sit on Galagedara's books.
//
// Dry-run by default; --apply to write.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const CODES = ["DT-56", "HEX-26"];

const proj = db.prepare("SELECT id FROM Project WHERE code='CEP-03F'").get() as any;
const tank = db.prepare("SELECT id,balance FROM BulkTank WHERE name='CEP-03F Galagedara'").get() as any;

const stats: Record<string, number> = { bills: 0, lineItems: 0, revisions: 0, payments: 0, assignments: 0, fuelIssues: 0, litresReturned: 0, unpinned: 0 };

if (APPLY) db.exec("BEGIN");
try {
  for (const code of CODES) {
    const a = db.prepare("SELECT id, projectId FROM Asset WHERE code=?").get(code) as any;
    if (!a) { console.log(`${code}: not found`); continue; }

    // Bills at CEP-03F (+ children)
    const bills = db.prepare("SELECT id FROM Bill WHERE assetId=? AND projectCode='CEP-03F'").all(a.id) as any[];
    for (const b of bills) {
      stats.revisions += (db.prepare("SELECT COUNT(*) n FROM BillRevision WHERE billId=?").get(b.id) as any).n;
      stats.payments += (db.prepare("SELECT COUNT(*) n FROM Payment WHERE billId=?").get(b.id) as any).n;
      stats.lineItems += (db.prepare("SELECT COUNT(*) n FROM BillLineItem WHERE billId=?").get(b.id) as any).n;
      if (APPLY) {
        db.prepare("DELETE FROM BillRevision WHERE billId=?").run(b.id);
        db.prepare("DELETE FROM Payment WHERE billId=?").run(b.id);
        db.prepare("DELETE FROM BillLineItem WHERE billId=?").run(b.id);
        db.prepare("DELETE FROM Bill WHERE id=?").run(b.id);
      }
    }
    stats.bills += bills.length;

    // Assignments to CEP-03F
    const asg = db.prepare("SELECT COUNT(*) n FROM AssetAssignment WHERE assetId=? AND projectId=?").get(a.id, proj.id) as any;
    stats.assignments += asg.n;
    if (APPLY) db.prepare("DELETE FROM AssetAssignment WHERE assetId=? AND projectId=?").run(a.id, proj.id);

    // Galagedara-tank fuel issues (return litres to the tank)
    const fi = db.prepare("SELECT id, litres FROM FuelIssue WHERE assetId=? AND bulkTankId=?").all(a.id, tank.id) as any[];
    const litres = fi.reduce((s, f) => s + f.litres, 0);
    stats.fuelIssues += fi.length;
    stats.litresReturned += litres;
    if (APPLY) db.prepare("DELETE FROM FuelIssue WHERE assetId=? AND bulkTankId=?").run(a.id, tank.id);

    // Unpin from CEP-03F
    if (a.projectId === proj.id) {
      stats.unpinned += 1;
      if (APPLY) db.prepare("UPDATE Asset SET projectId=NULL, updatedAt=? WHERE id=?").run(new Date().toISOString(), a.id);
    }

    if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN_ID, "DELETE", "Asset", a.id, `Removed ${code} from CEP-03F Galagedara (bills, assignment, ${litres} L fuel, site pin)`, new Date().toISOString());
  }

  // Return the removed fuel to the tank balance
  if (APPLY && stats.litresReturned > 0) {
    db.prepare("UPDATE BulkTank SET balance = balance + ?, updatedAt=? WHERE id=?").run(stats.litresReturned, new Date().toISOString(), tank.id);
  }

  if (APPLY) db.exec("COMMIT");
} catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

const newBalance = tank.balance + (APPLY ? stats.litresReturned : 0);
console.log(`=== REMOVE DT-56 + HEX-26 FROM GALAGEDARA ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(16)} ${v}`);
console.log(`  tank balance     ${tank.balance} → ${tank.balance + stats.litresReturned} L`);
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
