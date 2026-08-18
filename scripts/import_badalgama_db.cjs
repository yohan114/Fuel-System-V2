// Load Badalgama Plant/Workshop fuel from scripts/data/badalgama_fuel.json — the
// Badalgama fuel issues extracted from the archived app.db (Jun-27 snapshot,
// 2026-03-01..2026-06-23, 1,064 issues / 80,286 L). This is more complete than
// the Mar-May "Badalgama Plant" spreadsheets (it also covers June), so it is the
// authoritative Badalgama source. Badalgama is not in the Consolidated Register.
//
// Vehicles are matched to the fleet by code (146/148 already present); the two
// missing (PJ-6376, 59-5421) are created with their archived type/meter. Each
// Badalgama vehicle is pinned + assigned to the site. Replace-by-tank keeps it
// idempotent. Prices come straight from the archived rows (already in cents).
//
// Dry-run by default; --apply writes.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");
const fs = require("fs");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const SITE = "Badalgama Plant/Workshop";
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const { meta, issues } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/data/badalgama_fuel.json"), "utf8"));

const iso = (day, endOfDay = false) => new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`).toISOString();
const alnum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const OTHER_CAT = db.prepare("SELECT id FROM Category WHERE name='Other Asset'").get()?.id;

const project = db.prepare("SELECT id,name FROM Project WHERE name=?").get(SITE);
if (!project) throw new Error(`Project not found: ${SITE}`);
const tank = db.prepare("SELECT id FROM BulkTank WHERE projectId=?").get(project.id);
if (!tank) throw new Error(`Tank not found for ${SITE}`);

const byCode = new Map(db.prepare("SELECT id,code,meterType FROM Asset").all().map((a) => [alnum(a.code), a]));
const dieselPrices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all();
const priceFor = (day) => dieselPrices.find((p) => p.d <= day) ?? dieselPrices[dieselPrices.length - 1];

const now = new Date().toISOString();
const stats = { matched: 0, created: 0, issues: 0, litres: 0, meters: 0, assignments: 0 };
const created = [];
const resolved = new Map();

const insAsset = db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
const insMr = db.prepare(`INSERT INTO "MeterReading" (id,value,readingType,readingDate,source,createdAt,assetId,recordedById) VALUES (?,?,?,?,?,?,?,?)`);
const insAsg = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
const updPin = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);

function resolve(code) {
  const k = alnum(code);
  if (resolved.has(k)) return resolved.get(k);
  let rec;
  const hit = byCode.get(k);
  if (hit) { stats.matched++; rec = { id: hit.id, code: hit.code, meter: hit.meterType || "HOURS" }; }
  else {
    const m = meta[code] || {};
    const meter = m.meterType || "KM";
    const id = randomUUID();
    const isPlate = /^[A-Za-z]{0,4}[-\s]?\d{2,4}/.test(code);
    if (APPLY) insAsset.run(id, code.toUpperCase(), isPlate ? code.toUpperCase() : null, m.typeLabel || "From Badalgama db", "ACTIVE", meter, "OWNED", now, now, OTHER_CAT, project.id);
    byCode.set(k, { id, code: code.toUpperCase(), meterType: meter });
    stats.created++; rec = { id, code: code.toUpperCase(), meter };
    created.push({ code: code.toUpperCase(), type: m.typeLabel || "?", meter });
  }
  resolved.set(k, rec);
  return rec;
}

if (APPLY) { db.pragma("defer_foreign_keys = ON"); db.exec("BEGIN"); }
try {
  if (APPLY) {
    db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId=?`).run(tank.id);
    db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId=?`).run(project.id);
    db.prepare(`DELETE FROM "MeterReading" WHERE source='IMPORT' AND assetId IN (SELECT id FROM Asset WHERE projectId=?)`).run(project.id);
  }
  const span = new Map(); // assetId -> {min, max}
  for (const [day, code, litres, fuelKind, ppl0, meter] of issues) {
    const a = resolve(code);
    const fp = fuelKind === "AUTO_DIESEL" ? priceFor(day) : null;
    const ppl = ppl0 && ppl0 > 0 ? ppl0 : (fp ? fp.c : 0);
    if (APPLY) insFi.run(randomUUID(), fuelKind, litres, meter ?? null, meter != null ? a.meter : null, ppl, Math.round(litres * ppl), "Badalgama app.db (Mar-Jun 2026)", iso(day), now, a.id, ADMIN_ID, fp ? fp.id : null, tank.id);
    stats.issues++; stats.litres += litres;
    if (meter != null) { if (APPLY) insMr.run(randomUUID(), meter, a.meter, iso(day), "IMPORT", now, a.id, ADMIN_ID); stats.meters++; }
    const sp = span.get(a.id) ?? { min: day, max: day };
    if (day < sp.min) sp.min = day; if (day > sp.max) sp.max = day;
    span.set(a.id, sp);
  }
  for (const [assetId, sp] of span) {
    if (APPLY) { insAsg.run(randomUUID(), assetId, project.id, iso(sp.min), iso(sp.max, true), "Badalgama app.db", now, now, ADMIN_ID); updPin.run(project.id, now, assetId); }
    stats.assignments++;
  }
  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "CREATE", "Project", project.id, `Imported Badalgama fuel from app.db: ${stats.issues} issues (${Math.round(stats.litres)} L), ${stats.created} new assets`, now);
  if (APPLY) db.exec("COMMIT");
} catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

console.log(`\n=== BADALGAMA (from app.db) ${APPLY ? "APPLIED" : "DRY-RUN"} ===\n`);
console.log(`Fuel issues: ${stats.issues}  (${Math.round(stats.litres)} L)`);
console.log(`Meter reads: ${stats.meters} | Assignments: ${stats.assignments}`);
console.log(`Assets: ${stats.matched} matched, ${stats.created} created`);
if (created.length) for (const c of created) console.log(`   + ${c.code.padEnd(12)} ${c.meter}  "${c.type}"`);
if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write.`);
db.close();
