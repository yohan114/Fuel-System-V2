/* eslint-disable */
// Standardise Badalgama onto a single site. "Badalgama Plant" (BGP) is a
// duplicate of "Badalgama Plant/Workshop" (BADAL); BADAL holds all the fuel, BGP
// is empty apart from the workshop user (chamila) whose pump points at BGP's
// tank. Merge BGP -> BADAL: move any BGP references to BADAL, repoint the user,
// then delete BGP's tank and project so only "Badalgama Plant/Workshop" remains.
//
// Dry-run by default; --apply writes.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const one = (s, ...p) => db.prepare(s).get(...p);

const badal = one("SELECT id FROM Project WHERE name='Badalgama Plant/Workshop'");
const bgp = one("SELECT id FROM Project WHERE name='Badalgama Plant'");
if (!badal) throw new Error("Badalgama Plant/Workshop (BADAL) not found");
if (!bgp) { console.log("BGP 'Badalgama Plant' already gone — nothing to merge."); process.exit(0); }
const badalTank = one("SELECT id FROM BulkTank WHERE projectId=?", badal.id);
const bgpTanks = db.prepare("SELECT id,name FROM BulkTank WHERE projectId=?").all(bgp.id);

const stats = {};
const bump = (k, n = 1) => (stats[k] = (stats[k] || 0) + n);

db.pragma("defer_foreign_keys = ON");
db.exec("BEGIN"); // always run in a txn; commit on --apply, roll back on dry-run
try {
  // Move any transactional references from BGP -> BADAL (there should be few).
  bump("fuelIssues", db.prepare("UPDATE FuelIssue SET bulkTankId=? WHERE bulkTankId IN (SELECT id FROM BulkTank WHERE projectId=?)").run(badalTank?.id ?? null, bgp.id).changes);
  bump("bulkRequests", db.prepare("UPDATE BulkRequest SET bulkTankId=? WHERE bulkTankId IN (SELECT id FROM BulkTank WHERE projectId=?)").run(badalTank?.id ?? null, bgp.id).changes);
  bump("assignments", db.prepare("UPDATE AssetAssignment SET projectId=? WHERE projectId=?").run(badal.id, bgp.id).changes);
  bump("assetPins", db.prepare("UPDATE Asset SET projectId=? WHERE projectId=?").run(badal.id, bgp.id).changes);
  bump("bills", db.prepare("UPDATE Bill SET projectId=? WHERE projectId=?").run(badal.id, bgp.id).changes);
  bump("budgets", db.prepare("UPDATE Budget SET projectId=? WHERE projectId=?").run(badal.id, bgp.id).changes);
  // Repoint users scoped to BGP or its tank onto BADAL / its tank.
  bump("usersProject", db.prepare("UPDATE User SET projectId=? WHERE projectId=?").run(badal.id, bgp.id).changes);
  bump("usersTank", db.prepare("UPDATE User SET bulkTankId=? WHERE bulkTankId IN (SELECT id FROM BulkTank WHERE projectId=?)").run(badalTank?.id ?? null, bgp.id).changes);
  // Remove BGP's (now-unreferenced) tanks and the project itself.
  bump("tanksDeleted", db.prepare("DELETE FROM BulkTank WHERE projectId=?").run(bgp.id).changes);
  bump("projectsDeleted", db.prepare("DELETE FROM Project WHERE id=?").run(bgp.id).changes);

  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "DELETE", "Project", bgp.id, `Merged BGP 'Badalgama Plant' into 'Badalgama Plant/Workshop'; repointed users/records, removed duplicate site`, new Date().toISOString());
  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`=== MERGE BGP -> BADALGAMA PLANT/WORKSHOP ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(16)} ${v}`);
console.log(`\nBadalgama projects now: ${db.prepare("SELECT COUNT(*) n FROM Project WHERE name LIKE '%adalgama%'").get().n} (should be 1)`);
if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
db.close();
