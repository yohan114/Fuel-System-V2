import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Every project should own a bulk tank. New projects now get one automatically
// (createProjectAction); this backfills a default AUTO_DIESEL tank (capacity
// 15,000 L, balance 0) for any existing project that has none. Tanks stay fully
// editable/deletable afterwards.
//
// Dry-run by default; --apply to write.

const APPLY = process.argv.includes("--apply");
const DEFAULT_CAPACITY = 15000; // keep in sync with DEFAULT_TANK_CAPACITY
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";

const takenNames = new Set((db.prepare("SELECT name FROM BulkTank").all() as any[]).map((t) => t.name));
function uniqueName(name: string, code: string): string {
  for (const c of [`${name} Tank`, `${name} Tank (${code})`, `${code} Tank`]) {
    if (!takenNames.has(c)) { takenNames.add(c); return c; }
  }
  const fallback = `${name} Tank ${Date.now()}`;
  takenNames.add(fallback);
  return fallback;
}

const projects = db.prepare(`
  SELECT p.id, p.name, p.code
  FROM Project p
  WHERE NOT EXISTS (SELECT 1 FROM BulkTank t WHERE t.projectId = p.id)
  ORDER BY p.code
`).all() as any[];

console.log(`Projects without a tank: ${projects.length}\n`);
const now = new Date().toISOString();
const ins = db.prepare(`INSERT INTO "BulkTank" (id,name,fuelKind,capacity,balance,createdAt,updatedAt,projectId) VALUES (?,?,?,?,?,?,?,?)`);
const insAudit = db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`);

if (APPLY) db.exec("BEGIN");
try {
  for (const p of projects) {
    const tankName = uniqueName(p.name, p.code);
    if (APPLY) {
      const id = randomUUID();
      ins.run(id, tankName, "AUTO_DIESEL", DEFAULT_CAPACITY, 0, now, now, p.id);
      insAudit.run(randomUUID(), ADMIN_ID, "CREATE", "BulkTank", id, `Backfilled default tank "${tankName}" (${DEFAULT_CAPACITY} L) for project ${p.name} (${p.code})`, now);
    }
    console.log(`  ${p.code.padEnd(12)} ${p.name.padEnd(28)} → "${tankName}" (${DEFAULT_CAPACITY} L)`);
  }
  if (APPLY) db.exec("COMMIT");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`\n${APPLY ? "CREATED" : "WOULD CREATE"} ${projects.length} tank(s). ${APPLY ? "" : "Re-run with --apply to write."}`);
db.close();
