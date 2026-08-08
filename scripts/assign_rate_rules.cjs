/**
 * One-off rate assignment per the agreed category rules (2026-07).
 * Dry-run by default; pass --apply to commit. Idempotent (upserts RentalRate by
 * assetId; re-running restores the same values).
 *
 * Bases: plant/portable equipment → DRY; road vehicles → WET (not fully-wet).
 * "do not add wet" on plant → only the dry tier is set. Fuel-Only vehicles get
 * billFuelOnly=1 and no rate card.
 */
const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");
const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const norm = (x) => String(x).trim().toUpperCase().replace(/\s+/g, "");
const alnum = (x) => String(x).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const assets = db.prepare("SELECT id,code,regNo,meterType,categoryId,billFuelOnly FROM Asset WHERE status!='DISPOSED'").all();
const byKey = new Map();
for (const a of assets) for (const k of [norm(a.code), alnum(a.code)]) if (k && !byKey.has(k)) byKey.set(k, a);
const find = (c) => byKey.get(norm(c)) || byKey.get(alnum(c)) || null;
const acCatId = (db.prepare("SELECT id FROM Category WHERE name='PE - Air Compressor'").get() || {}).id;

// group, codes, equipType, tier column, rate (cents), basis, recategorize?
const RULES = [
  { g: "Motor Grader",   codes: ["MG-18"], equip: "FLEET",    col: "hrDCents",   cents: 435000,  basis: "d" },
  { g: "Dump Truck",     codes: ["LO-4625","LO-4826","LO-8783","LK-5141","LL-1882"], equip: "FLEET", col: "kmWCents", cents: 12000, basis: "w" },
  { g: "Farm Tractor",   codes: ["37-8277"], equip: "FLEET",  col: "hrWCents",   cents: 450000,  basis: "w" },
  { g: "Air Compressor", codes: ["AC-25","AC-27","AC-42","AC-43","AC-44"], equip: "PORTABLE", col: "portDdCents", cents: 1100000, basis: "d", recat: acCatId },
  { g: "Concrete Mixer", codes: ["CM24"], equip: "PORTABLE",  col: "portDdCents", cents: 300000, basis: "d" },
  { g: "Generator",      codes: ["GE 105","GE 11","GE-01","GE-10","GE-106","GE-117","GE-118","GE-121","GE-143","GE-34","GE-37","GE-53","GE-60","GE-66","GE-69","GE-84"], equip: "PORTABLE", col: "portDdCents", cents: 600000, basis: "d" },
];
const FUEL_ONLY = ["GL-8776","DAA-7422","DAC-6545","DAE-6559","DAG-1016","DAH-6545","DAI-4487","GC-1328","GD-405","GD-7104","GJ-0019","LG-0019","LI-370"];

const hasRate = db.prepare("SELECT id FROM RentalRate WHERE assetId=?");
function upsertRate(assetId, equip, col, cents, basis) {
  const existing = hasRate.get(assetId);
  if (existing) {
    db.prepare(`UPDATE RentalRate SET equipType=@equip, ${col}=@cents, defaultBasis=@basis, sourceLabel='Manual rate rules 2026-07', updatedAt=CURRENT_TIMESTAMP WHERE assetId=@assetId`).run({ equip, cents, basis, assetId });
    return "updated";
  }
  db.prepare(`INSERT INTO RentalRate (id,assetId,equipType,${col},defaultBasis,sourceLabel,createdAt,updatedAt) VALUES (@id,@assetId,@equip,@cents,@basis,'Manual rate rules 2026-07',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run({ id: crypto.randomUUID(), assetId, equip, cents, basis });
  return "created";
}

db.exec("BEGIN");
let created = 0, updated = 0, recat = 0, fuel = 0, missing = [];
console.log(`\n════ RATE ASSIGNMENT  (${APPLY ? "APPLY" : "DRY-RUN"}) ════\n`);
for (const rule of RULES) {
  console.log(`── ${rule.g}  →  ${rule.basis === "d" ? "DRY" : "WET"} ${(rule.cents / 100).toLocaleString()} (${rule.col.replace("Cents", "")})`);
  for (const code of rule.codes) {
    const a = find(code);
    if (!a) { missing.push(code); console.log(`   ${code.padEnd(10)} NOT FOUND`); continue; }
    const r = upsertRate(a.id, rule.equip, rule.col, rule.cents, rule.basis);
    r === "created" ? created++ : updated++;
    let extra = "";
    if (rule.recat && acCatId && a.categoryId !== acCatId) { db.prepare("UPDATE Asset SET categoryId=? WHERE id=?").run(acCatId, a.id); recat++; extra = " [recategorized → PE - Air Compressor]"; }
    console.log(`   ${a.code.padEnd(10)} ${r}${extra}`);
  }
}
console.log(`\n── Fuel Only  →  billFuelOnly=1, no rate`);
for (const code of FUEL_ONLY) {
  const a = find(code);
  if (!a) { missing.push(code); console.log(`   ${code.padEnd(10)} NOT FOUND`); continue; }
  db.prepare("UPDATE Asset SET billFuelOnly=1 WHERE id=?").run(a.id);
  fuel++;
  console.log(`   ${a.code.padEnd(10)} set fuel-only`);
}

console.log(`\nSummary: rate created=${created} updated=${updated} | recategorized=${recat} | fuel-only=${fuel} | not found=${missing.length}${missing.length ? " ("+missing.join(", ")+")" : ""}`);
if (APPLY) { db.exec("COMMIT"); console.log("\n✓ APPLIED."); }
else { db.exec("ROLLBACK"); console.log("\n(DRY-RUN) nothing written — re-run with --apply."); }
db.close();
