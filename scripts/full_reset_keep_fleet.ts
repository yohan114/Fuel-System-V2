import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// FULL DATA RESET — clears operational + site data for a fresh rebuild, while
// KEEPING the fleet master and reference data so 771 vehicles don't have to be
// re-entered:
//   DELETE  fuel issues, bills (+ line items / revisions / payments / credits),
//           assignments, meter readings, daily conditions, bulk requests, tank
//           dips, corrections, fuel requests, budgets, PM tasks, tanks,
//           projects/sites, audit log, and every user except admin.
//   KEEP    admin login, vehicles + rate cards, categories, fuel prices,
//           lubricants, filters, service history, settings.
//
// Dry-run by default; --apply writes in one transaction.

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// Tables whose rows are fully cleared.
const WIPE = [
  "BillLineItem", "BillRevision", "Payment", "CreditNote", "Bill",
  "FuelIssue", "AssetAssignment", "MeterReading", "DailyCondition",
  "BulkRequest", "TankDip", "FuelIssueCorrection", "FuelRequest",
  "Budget", "PMTask", "BulkTank", "Project", "AuditLog",
];

const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get() as any).n;

const before: Record<string, number> = {};
for (const t of WIPE) before[t] = count(t);
const usersBefore = count("User");

if (APPLY) {
  db.pragma("defer_foreign_keys = ON");
  db.exec("BEGIN");
  try {
    // Reassign kept-table user refs to admin (RESTRICT columns on kept tables)
    db.prepare(`UPDATE "FuelPrice"     SET enteredById=? WHERE enteredById<>?`).run(ADMIN_ID, ADMIN_ID);
    db.prepare(`UPDATE "ServiceRecord" SET recordedById=? WHERE recordedById<>?`).run(ADMIN_ID, ADMIN_ID);
    // Null kept-table refs to soon-deleted projects / tanks / users
    db.prepare(`UPDATE "Asset" SET projectId=NULL WHERE projectId IS NOT NULL`).run();
    db.prepare(`UPDATE "User"  SET projectId=NULL, bulkTankId=NULL, createdById=NULL`).run();

    for (const t of WIPE) db.prepare(`DELETE FROM "${t}"`).run();
    // Every user except admin
    db.prepare(`DELETE FROM "User" WHERE id<>?`).run(ADMIN_ID);

    // Fresh audit trail marker
    db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), ADMIN_ID, "DELETE", "System", ADMIN_ID,
        "Full data reset: cleared fuel issues, bills, assignments, readings, conditions, tanks, projects and non-admin users. Kept fleet, rate cards, prices, categories.", new Date().toISOString());

    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

console.log(`=== FULL RESET ${APPLY ? "APPLIED" : "DRY-RUN"} ===\n`);
console.log("Deleted:");
for (const t of WIPE) console.log(`  ${t.padEnd(20)} ${before[t]} → ${APPLY ? count(t) : "(would be 0)"}`);
console.log(`  ${"User (non-admin)".padEnd(20)} ${usersBefore - 1} → ${APPLY ? count("User") - 1 : "(would be 0)"}`);
console.log("\nKept:");
for (const t of ["Asset", "RentalRate", "Category", "FuelPrice", "Lubricant", "Filter", "AssetFilter", "ServiceRecord", "Setting"])
  console.log(`  ${t.padEnd(20)} ${count(t)}`);
console.log(`  ${"User (admin)".padEnd(20)} ${APPLY ? count("User") : 1}`);
const admin = db.prepare("SELECT username,role,active FROM User WHERE id=?").get(ADMIN_ID) as any;
console.log(`\nAdmin login intact: ${admin ? `${admin.username} (${admin.role}, active=${admin.active})` : "MISSING!"}`);
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
