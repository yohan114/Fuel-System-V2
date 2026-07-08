import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Recreate the 24 project sites (after the full reset), each with its own
// AUTO_DIESEL tank. Four duplicate pairs were merged per the owner:
//   LOT 02 → ICDP Batti Lot-02 (BATTI-02)
//   Ruwanwella Site → Ruwanwella Water Project (RWP)
//   Marawila Road Site → Marawila Site (MARA)
//   CEP-03 → CEP-03 Epackage (CEP-03 E)
// Capacities match the originals (CEP-03F 2,500 L, MUTHUR 5,000 L, rest 15,000).
//
// Dry-run by default; --apply to write.

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// [code, name, tankCapacity]
const SITES: [string, string, number][] = [
  ["AMB", "Ambanpola", 15000],
  ["AVIS", "Avissawella Site", 15000],
  ["BADAL", "Badalgama Plant/Workshop", 15000],
  ["BATTI", "ICDP Batti Lot-03", 15000],
  ["BATTI-02", "ICDP Batti Lot-02", 15000],
  // BGP "Badalgama Plant" removed — merged into BADAL "Badalgama Plant/Workshop"
  ["CEP-03 E", "CEP-03 Epackage", 15000],
  ["CEP-03-ABC", "CEP-03 A,B & C Package", 15000],
  ["CEP-03F", "CEP-03F Galagedara", 2500],
  ["ECT", "ECTO Engineering", 15000],
  ["GB", "Gampaha Bridge", 15000],
  ["HO", "Head Office", 15000],
  ["INGI", "Inginimitiya", 15000],
  ["KB", "Karativu Bridge", 15000],
  ["LOT-04", "I Project - LOT-04", 15000],
  ["MARA", "Marawila Site", 15000],
  ["MCE", "Mrs. Charitha's Estate", 15000],
  ["MDE", "Mundalam Estate", 15000],
  ["MLB", "Mallawagedara Bridge", 15000],
  ["MUTHUR", "MUTHUR PLANT", 5000],
  ["PNB", "Pallanoya Bridge", 15000],
  ["RWP", "Ruwanwella Water Project", 15000],
  ["TLIN", "Mr Thilina", 15000],
  ["WCP", "Wadakada CEP-3", 15000],
  ["WFQ", "Wastage Fuels", 15000],
];

const now = new Date().toISOString();
let created = 0, skipped = 0;

if (APPLY) db.exec("BEGIN");
try {
  const insP = db.prepare(`INSERT INTO "Project" (id,name,code,createdAt,updatedAt) VALUES (?,?,?,?,?)`);
  const insT = db.prepare(`INSERT INTO "BulkTank" (id,name,fuelKind,capacity,balance,createdAt,updatedAt,projectId) VALUES (?,?,?,?,?,?,?,?)`);
  const insA = db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`);
  for (const [code, name, cap] of SITES) {
    const exists = db.prepare("SELECT id FROM Project WHERE code=? OR name=?").get(code, name);
    if (exists) { skipped++; console.log(`  skip  ${code.padEnd(11)} ${name} (already exists)`); continue; }
    const pid = randomUUID(), tid = randomUUID();
    const tankName = `${name} Tank`;
    if (APPLY) {
      insP.run(pid, name, code, now, now);
      insT.run(tid, tankName, "AUTO_DIESEL", cap, 0, now, now, pid);
      insA.run(randomUUID(), ADMIN_ID, "CREATE", "Project", pid, `Recreated site ${name} (${code}) with tank "${tankName}" (${cap} L)`, now);
    }
    created++;
    console.log(`  ${APPLY ? "create" : "would"} ${code.padEnd(11)} ${name.padEnd(30)} → ${tankName} [${cap} L]`);
  }
  if (APPLY) db.exec("COMMIT");
} catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

console.log(`\n=== RECREATE SITES ${APPLY ? "APPLIED" : "DRY-RUN"} === created ${created}, skipped ${skipped}`);
console.log(`Projects now: ${(db.prepare("SELECT COUNT(*) n FROM Project").get() as any).n} | Tanks now: ${(db.prepare("SELECT COUNT(*) n FROM BulkTank").get() as any).n}`);
if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
db.close();
