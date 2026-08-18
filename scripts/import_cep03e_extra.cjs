// Add-only import of CEP-03 E Package fuel from the EXTERNALDATA app.db extract
// (scripts/data/cep03e_external.json). The Consolidated Register already holds
// CEP-03 E (1,010 issues from the CEP_03_E_Package workbook) and stays
// authoritative — this only APPENDS entries from the live db that are not already
// present (matched on Colombo date + vehicle code + litres), so the register data
// is never duplicated or replaced. Idempotent: a second run adds nothing.
//
// Dry-run by default; --apply writes.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const path = require("path");
const fs = require("fs");

const APPLY = process.argv.includes("--apply");
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const SITE = "CEP-03 Epackage";
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const { meta, issues } = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/data/cep03e_external.json"), "utf8"));

const iso = (day, endOfDay = false) => new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`).toISOString();
const colomboDay = (isoTs) => new Date(new Date(isoTs).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const alnum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const OTHER_CAT = db.prepare("SELECT id FROM Category WHERE name='Other Asset'").get()?.id;

const project = db.prepare("SELECT id,name FROM Project WHERE name=?").get(SITE);
if (!project) throw new Error(`Project not found: ${SITE}`);
const tank = db.prepare("SELECT id FROM BulkTank WHERE projectId=?").get(project.id);
if (!tank) throw new Error(`Tank not found for ${SITE}`);

const byCode = new Map(db.prepare("SELECT id,code,meterType FROM Asset").all().map((a) => [alnum(a.code), a]));
const dieselPrices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all();
const priceFor = (day) => dieselPrices.find((p) => p.d <= day) ?? dieselPrices[dieselPrices.length - 1];

// existing CEP-03 E issues -> set of "colomboDay|codeAlnum|litres"
const existing = new Set();
for (const r of db.prepare(`SELECT a.code, f.issueDate, f.litres FROM FuelIssue f JOIN Asset a ON a.id=f.assetId WHERE f.bulkTankId=?`).all(tank.id))
  existing.add(`${colomboDay(r.issueDate)}|${alnum(r.code)}|${r.litres}`);

const now = new Date().toISOString();
const stats = { added: 0, skipped: 0, created: 0, litres: 0 };
const added = [];
const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
const insAsset = db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

function resolve(code) {
  const k = alnum(code); const hit = byCode.get(k);
  if (hit) return { id: hit.id, meter: hit.meterType || "KM" };
  const m = meta[code] || {}; const meter = m.meterType || "KM"; const id = randomUUID();
  if (APPLY) insAsset.run(id, code.toUpperCase(), /^[A-Za-z]{0,4}[-\s]?\d{2,4}/.test(code) ? code.toUpperCase() : null, m.typeLabel || "From CEP-03 E db", "ACTIVE", meter, "OWNED", now, now, OTHER_CAT, project.id);
  byCode.set(k, { id, code: code.toUpperCase(), meterType: meter });
  stats.created++;
  return { id, meter };
}

if (APPLY) db.exec("BEGIN");
try {
  // in-batch dedup too (the extract itself may repeat a colombo/code/litres)
  const batchSeen = new Set();
  for (const [day, code, litres, fuelKind, ppl0, meter] of issues) {
    const key = `${day}|${alnum(code)}|${litres}`;
    if (existing.has(key) || batchSeen.has(key)) { stats.skipped++; continue; }
    batchSeen.add(key);
    const a = resolve(code);
    const fp = fuelKind === "AUTO_DIESEL" ? priceFor(day) : null;
    const ppl = ppl0 && ppl0 > 0 ? ppl0 : (fp ? fp.c : 0);
    if (APPLY) insFi.run(randomUUID(), fuelKind, litres, meter ?? null, meter != null ? a.meter : null, ppl, Math.round(litres * ppl), "CEP-03 E live db (add-only)", iso(day), now, a.id, ADMIN_ID, fp ? fp.id : null, tank.id);
    stats.added++; stats.litres += litres; added.push(`${day} ${code} ${litres}L`);
  }
  if (APPLY && stats.added) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "CREATE", "Project", project.id, `Appended ${stats.added} CEP-03 E fuel issues from live db (not already present)`, now);
  if (APPLY) db.exec("COMMIT");
} catch (e) { if (APPLY) db.exec("ROLLBACK"); throw e; }

console.log(`\n=== CEP-03 E ADD-ONLY ${APPLY ? "APPLIED" : "DRY-RUN"} ===`);
console.log(`Added ${stats.added} (${Math.round(stats.litres)} L), skipped ${stats.skipped} already present, ${stats.created} assets created`);
for (const a of added) console.log(`   + ${a}`);
if (!APPLY) console.log(`\nDry-run only. Re-run with --apply to write.`);
db.close();
