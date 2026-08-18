// Workstream B — validate/fix tank balances and stamp an accountable issue
// person on every fuel issue.
//
// Balances: the Jul-8 live backup carries authoritative current balances for the
// tanks it holds — Badalgama Plant/Workshop 2,736.8 L (the owner's stated
// figure), Wadakada 4,500, CEP-03 E 1,726, Marawila 300, Mallawagedara 60,
// LOT-04 / Inginimitiya / Ruwanwella 0. Those are applied here; tanks not in the
// backup keep the closing balance derived from their source stock sheets.
//
// Issue person: every issue is stamped with the responsible operator for the
// site it was physically drawn at — the site's pump user where one exists
// (Ishadi, Lalith, …; Chamila for the Badalgama workshop), else the site name so
// no issue is left without an accountable person / site reference.
//
// Dry-run by default; --apply writes.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const all = (s, ...p) => db.prepare(s).all(...p);
const one = (s, ...p) => db.prepare(s).get(...p);

// authoritative balances from the live backup (by project name)
const BALANCES = {
  "Badalgama Plant/Workshop": 2736.8,
  "Wadakada CEP-3": 4500,
  "CEP-03 Epackage": 1726,
  "Marawila Site": 300,
  "Mallawagedara Bridge": 60,
  "I Project - LOT-04": 0,
  "Inginimitiya": 0,
  "Ruwanwella Water Project": 0,
};

// responsible operator per site (project id -> display name)
const projByName = new Map(all("SELECT id,name FROM Project").map((p) => [p.name, p.id]));
const nameById = new Map(all("SELECT id,name FROM Project").map((p) => [p.id, p.name]));
const personBySite = new Map();
for (const u of all("SELECT name, role, projectId, bulkTankId FROM User WHERE active=1")) {
  let pid = u.projectId;
  if (!pid && u.bulkTankId) { const t = one("SELECT projectId FROM BulkTank WHERE id=?", u.bulkTankId); pid = t?.projectId ?? null; }
  if (pid && (u.role === "SITE_PUMP" || u.role === "WORKSHOP")) personBySite.set(pid, u.name);
}

db.pragma("defer_foreign_keys = ON");
db.exec("BEGIN");
const stats = { balancesSet: 0, personSet: 0, personBackfilled: 0 };
try {
  // 1. balances
  const now = new Date().toISOString();
  for (const [name, bal] of Object.entries(BALANCES)) {
    const pid = projByName.get(name); if (!pid) continue;
    stats.balancesSet += db.prepare("UPDATE BulkTank SET balance=?, updatedAt=? WHERE projectId=?").run(bal, now, pid).changes;
  }

  // 2. issue person — responsible operator for the physical tank's site, else site name
  const issues = all(`SELECT f.id, t.projectId pid FROM FuelIssue f LEFT JOIN BulkTank t ON t.id=f.bulkTankId`);
  const upd = db.prepare("UPDATE FuelIssue SET issuePerson=? WHERE id=?");
  for (const i of issues) {
    const person = (i.pid && personBySite.get(i.pid)) || (i.pid && nameById.get(i.pid)) || "Site Office";
    upd.run(person, i.id); stats.personSet++;
  }

  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "UPDATE", "BulkTank", ADMIN_ID, `Set authoritative tank balances (Badalgama 2,736.8 L +7) and stamped issue person on ${stats.personSet} fuel issues`, now);
  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`=== FIX BALANCES + ISSUE PERSON ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
console.log(`Tank balances set (authoritative): ${stats.balancesSet}`);
console.log(`Issue person stamped: ${stats.personSet}`);
console.log("\nResponsible person by site:");
for (const [pid, nm] of personBySite) console.log(`  ${(nameById.get(pid) || pid).padEnd(26)} → ${nm}`);
console.log("\nTank balances after:");
for (const t of all(`SELECT p.name, t.balance FROM BulkTank t JOIN Project p ON p.id=t.projectId ORDER BY t.balance DESC`))
  console.log(`  ${p_name(t.name).padEnd(26)} ${t.balance} L${BALANCES[t.name] !== undefined ? "  (authoritative)" : "  (sheet-derived)"}`);
function p_name(n) { return n; }
console.log(`\nIssues without a person: ${one("SELECT COUNT(*) n FROM FuelIssue WHERE issuePerson IS NULL OR issuePerson=''").n} | without a tank: ${one("SELECT COUNT(*) n FROM FuelIssue WHERE bulkTankId IS NULL").n}`);
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
