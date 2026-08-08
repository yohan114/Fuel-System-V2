/* eslint-disable */
// Merge duplicate vehicle records into one master each, so every physical
// vehicle has a single clean history.
//
// Two duplicate signals, both driven by the fleet's own data (not guesswork):
//  1. Plate placeholder — a generic asset whose CODE equals a properly E&C-coded
//     asset's regNo (e.g. placeholder "ZA-7092" ↔ master "LB-11" reg ZA-7092).
//     The E&C-coded record is the master; the placeholder merges in.
//  2. Code-format duplicate — two assets whose codes are identical once
//     punctuation/spacing is stripped (e.g. "ZB - 0050" ↔ "ZB-0050"). The record
//     carrying more fuel history (tie-break: cleaner code) is the master.
//
// Vehicles that merely share a junk regNo (e.g. five excavators all stamped
// "14160") are NOT touched — there is no asset coded "14160", so signal 1 never
// fires for them.
//
// Every asset-linked record (fuel issues, requests, meter readings, conditions,
// assignments, corrections, bills, service, filters, rate card) is reassigned to
// the master; exact-duplicate issues/assignments created by the merge are then
// collapsed. Finally, for CEP-03F Galagedara (site live from 11 May 2026) each
// merged vehicle's Galagedara assignment start is set to its earliest fuel issue
// on/after 11 May — the vehicle's first-fuel date at that site.
//
// Dry-run by default; --apply writes.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const GALA_START = "2026-05-11";
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const all = (s, ...p) => db.prepare(s).all(...p);
const one = (s, ...p) => db.prepare(s).get(...p);
const norm = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const assets = all("SELECT id,code,regNo,typeLabel FROM Asset");
const byCode = new Map(assets.map((a) => [norm(a.code), a]));
const fuelCount = (id) => one("SELECT COUNT(*) n FROM FuelIssue WHERE assetId=?", id).n;

// ---- build placeholder -> master map ----
const target = new Map(); // placeholderId -> masterId
// 1. plate placeholder
for (const M of assets) {
  if (!M.regNo) continue;
  const r = M.regNo.trim();
  const plateish = (/[A-Za-z]/.test(r) && /\d/.test(r)) || /^\d{2,3}-\d{3,4}$/.test(r);
  if (!plateish) continue;
  const P = byCode.get(norm(M.regNo));
  if (P && P.id !== M.id && !target.has(P.id)) target.set(P.id, M.id);
}
// 2. code-format dups — master = most fuel, tie-break cleaner (shorter) code
const groups = {};
for (const a of assets) (groups[norm(a.code)] = groups[norm(a.code)] || []).push(a);
for (const g of Object.values(groups)) {
  if (g.length < 2) continue;
  const master = [...g].sort((x, y) => fuelCount(y.id) - fuelCount(x.id) || x.code.length - y.code.length)[0];
  for (const a of g) if (a.id !== master.id && !target.has(a.id)) target.set(a.id, master.id);
}
// resolve chains (a master that is itself a placeholder) to the ultimate root
function root(id) { let m = id, guard = 0; while (target.has(m) && guard++ < 20) m = target.get(m); return m; }

const codeById = new Map(assets.map((a) => [a.id, a.code]));
const pairs = [...target.keys()].map((pid) => ({ placeholderId: pid, masterId: root(pid) })).filter((p) => p.placeholderId !== p.masterId);

// asset-FK tables reassigned wholesale (no per-asset unique constraint)
const FK_TABLES = ["FuelRequest", "MeterReading", "DailyCondition", "Bill", "AssetAssignment", "FuelIssueCorrection", "FuelIssue", "ServiceRecord", "AssetFilter"];

const stats = { pairs: pairs.length, moved: {}, rateKept: 0, rateMoved: 0, dupIssues: 0, dupAsg: 0, galaSet: 0 };
for (const t of FK_TABLES) stats.moved[t] = 0;

db.pragma("defer_foreign_keys = ON");
db.exec("BEGIN");
try {
  for (const { placeholderId, masterId } of pairs) {
    for (const t of FK_TABLES)
      stats.moved[t] += db.prepare(`UPDATE "${t}" SET assetId=? WHERE assetId=?`).run(masterId, placeholderId).changes;
    // RentalRate / ServiceInterval: unique per asset — keep master's, else move placeholder's
    for (const t of ["RentalRate", "ServiceInterval"]) {
      const hasMaster = one(`SELECT 1 FROM "${t}" WHERE assetId=?`, masterId);
      if (hasMaster) { const c = db.prepare(`DELETE FROM "${t}" WHERE assetId=?`).run(placeholderId).changes; if (t === "RentalRate") stats.rateKept += c; }
      else { const c = db.prepare(`UPDATE "${t}" SET assetId=? WHERE assetId=?`).run(masterId, placeholderId).changes; if (t === "RentalRate") stats.rateMoved += c; }
    }
    db.prepare("DELETE FROM Asset WHERE id=?").run(placeholderId);
  }

  // collapse exact-duplicate fuel issues created by the merge (same vehicle, day,
  // litres, tank, kind, source) — keep the earliest-created row.
  stats.dupIssues = db.prepare(`
    DELETE FROM FuelIssue WHERE id NOT IN (
      SELECT MIN(id) FROM FuelIssue GROUP BY assetId, issueDate, litres, bulkTankId, fuelKind, source
    ) AND id IN (
      SELECT f.id FROM FuelIssue f GROUP BY f.assetId, f.issueDate, f.litres, f.bulkTankId, f.fuelKind, f.source HAVING COUNT(*) > 1
    )`).run().changes;
  // collapse exact-duplicate assignments (same vehicle, site, start, end)
  stats.dupAsg = db.prepare(`
    DELETE FROM AssetAssignment WHERE id NOT IN (
      SELECT MIN(id) FROM AssetAssignment GROUP BY assetId, projectId, startDate, IFNULL(endDate,'')
    )`).run().changes;

  // ---- Galagedara first-fuel date per merged vehicle ----
  const gala = one("SELECT p.id pid, t.id tid FROM Project p JOIN BulkTank t ON t.projectId=p.id WHERE p.name='CEP-03F Galagedara'");
  if (gala) {
    const firsts = all(`
      SELECT f.assetId, MIN(f.issueDate) firstIso
      FROM FuelIssue f WHERE f.bulkTankId=? AND f.issueDate >= ?
      GROUP BY f.assetId`, gala.tid, new Date(`${GALA_START}T00:00:00+05:30`).toISOString());
    for (const r of firsts) {
      const c = db.prepare(`UPDATE AssetAssignment SET startDate=? WHERE assetId=? AND projectId=? AND startDate < ?`)
        .run(r.firstIso, r.assetId, gala.pid, r.firstIso).changes;
      // ensure the assignment reflects the first-fuel date even if it already matched
      stats.galaSet += (c || one(`SELECT 1 FROM AssetAssignment WHERE assetId=? AND projectId=?`, r.assetId, gala.pid) ? 1 : 0);
    }
    stats.galaFirsts = firsts.length;
  }

  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "UPDATE", "Asset", ADMIN_ID, `Merged ${pairs.length} duplicate vehicles into masters; reassigned all fuel/records; set Galagedara first-fuel dates`, new Date().toISOString());
  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) { db.exec("ROLLBACK"); throw e; }

console.log(`=== MERGE DUPLICATE VEHICLES ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
console.log(`Merged pairs: ${stats.pairs}`);
console.log("Records reassigned to masters:");
for (const [t, n] of Object.entries(stats.moved)) if (n) console.log(`  ${t.padEnd(20)} ${n}`);
console.log(`RentalRate: ${stats.rateMoved} moved, ${stats.rateKept} placeholder dropped (master kept)`);
console.log(`Post-merge dedup: ${stats.dupIssues} duplicate fuel issues, ${stats.dupAsg} duplicate assignments removed`);
console.log(`Galagedara first-fuel dates set: ${stats.galaSet}/${stats.galaFirsts || 0} vehicles (from ${GALA_START})`);
console.log(`Assets: ${one("SELECT COUNT(*) n FROM Asset").n} | FuelIssues: ${one("SELECT COUNT(*) n FROM FuelIssue").n}`);
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
