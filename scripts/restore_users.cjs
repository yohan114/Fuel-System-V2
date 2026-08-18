// One-shot restore of the site user accounts that the full data reset removed.
// Source: the Jul-8 live backup (EXTERNALDATA app.db, passed as argv). Restores
// every ACTIVE account except the already-present `admin` (so: malinga [admin],
// the 5 SITE_PUMP operators, and chamila [workshop]) — the inactive test account
// is skipped. Password hashes are copied verbatim, so users log in as before.
// Project/tank scoping is re-mapped by name to the current database's ids.
//
// Idempotent: an account whose username already exists is skipped.
//
//   node scripts/restore_users.cjs /path/to/backup/app.db [--apply]

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const EXT_PATH = process.argv.find((a) => a.endsWith(".db"));
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
if (!EXT_PATH) throw new Error("pass the backup app.db path");

const ext = new Database(EXT_PATH, { readonly: true });
const db = new Database(path.join(process.cwd(), "data", "app.db"));

// name-keyed maps of the current db
const myProjByName = new Map(db.prepare("SELECT id,name FROM Project").all().map((p) => [p.name, p.id]));
const myTankByProj = new Map(db.prepare("SELECT projectId, id FROM BulkTank WHERE projectId IS NOT NULL").all().map((t) => [t.projectId, t.id]));
const BADALGAMA_TANK = myTankByProj.get(myProjByName.get("Badalgama Plant/Workshop"));

const extProjName = (id) => id ? (ext.prepare("SELECT name FROM Project WHERE id=?").get(id) || {}).name : null;
const extTankProj = (id) => { if (!id) return null; const t = ext.prepare("SELECT projectId FROM BulkTank WHERE id=?").get(id); return t ? extProjName(t.projectId) : null; };

const users = ext.prepare("SELECT * FROM User WHERE active=1 AND username<>'admin' ORDER BY role, username").all();
const now = new Date().toISOString();
const ins = db.prepare(`INSERT INTO "User" (id,username,email,name,passwordHash,role,active,createdAt,updatedAt,createdById,projectId,bulkTankId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const report = [];

if (APPLY) db.exec("BEGIN");
try {
  for (const u of users) {
    if (db.prepare("SELECT 1 FROM User WHERE lower(username)=lower(?)").get(u.username)) { report.push([u.username, u.role, "skip (exists)"]); continue; }
    // map project scoping by name
    const projName = extProjName(u.projectId);
    const myProjectId = projName ? (myProjByName.get(projName) || null) : null;
    // map tank: prefer the mapped project's tank; else (workshop pump) the Badalgama tank
    let myTankId = null;
    if (u.bulkTankId) {
      const tankProjName = extTankProj(u.bulkTankId);
      const tankProjId = tankProjName ? myProjByName.get(tankProjName) : null;
      myTankId = (tankProjId && myTankByProj.get(tankProjId)) || (myProjectId && myTankByProj.get(myProjectId)) || (/workshop|badalgama/i.test(u.name + " " + (tankProjName || "")) ? BADALGAMA_TANK : null);
    } else if (myProjectId) {
      myTankId = myTankByProj.get(myProjectId) || null;
    }
    if (APPLY) ins.run(randomUUID(), u.username, u.email || null, u.name, u.passwordHash, u.role, u.active, u.createdAt || now, now, ADMIN_ID, myProjectId, myTankId);
    report.push([u.username, u.role, `restore${projName ? " → " + projName : ""}${myTankId ? " (tank set)" : ""}`]);
  }
  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "CREATE", "User", ADMIN_ID, `Restored ${report.filter((r) => r[2].startsWith("restore")).length} user accounts from the Jul-8 backup`, now);
  if (APPLY) db.exec("COMMIT");
} catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

console.log(`\n=== RESTORE USERS ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
for (const [u, r, action] of report) console.log(`  ${u.padEnd(16)} ${String(r).padEnd(10)} ${action}`);
console.log(`\nUsers now: ${db.prepare("SELECT COUNT(*) n FROM User").get().n}`);
if (!APPLY) console.log("Dry-run only. Re-run with --apply to write.");
ext.close(); db.close();
