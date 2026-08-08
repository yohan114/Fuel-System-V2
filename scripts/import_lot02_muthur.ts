import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { LOT02_MUTHUR_ISSUES } from "./data/lot02_muthur_fuel";

// Load the LOT 02 and MUTHUR PLANT monthly fuel sheets into the system so both
// sites become billable + monitored (mirrors the Galagedara stock-book load).
//
//  - Reg plates are matched to existing E&C assets (by code OR regNo); the 16
//    genuinely-new machines are created under OTHER with the reg plate as a
//    temporary code, flagged for proper coding later.
//  - Fuel issues are priced by the diesel price in effect on each Colombo date.
//  - Each vehicle is posted to its site once PER MONTH it appears (window =
//    first→last issue that month), so a gap between months is never billed and
//    a part-month arrival is prorated. Allocation date = first fuel that month.
//
// REPLACE load, idempotent: clears each site's prior issues / postings first.
// Dry-run by default; --apply writes in one transaction.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const OTHER_CATEGORY = "5caa3321-da5d-4374-aa0d-5d0fdb84ed4b";

const SITES: Record<string, { code: string; tank: string }> = {
  "LOT 02": { code: "LOT-02", tank: "LOT 02 Tank" },
  "MUTHUR PLANT": { code: "MUTHUR", tank: "MUTHUR Plant Tank" },
};

// New machines needing a non-default meter type / hire flag (best guess; the
// user recodes in Fleet). Everything else new defaults to KM / OWNED.
const HOURS_NEW = new Set(["GE-84", "LT-18", "LT-10", "WG-63", "AC-42"]);
const HIRE_NEW = new Set(["226-3544"]);

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const iso = (day: string, endOfDay = false) =>
  new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`).toISOString();

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
const notes: string[] = [];

db.exec("BEGIN");
db.pragma("defer_foreign_keys = ON");
try {
  const now = new Date().toISOString();

  // ---- Prices (diesel, by date) ----
  const prices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all() as any[];
  const priceFor = (day: string) => prices.find((p) => p.d <= day) ?? prices[prices.length - 1];

  // ---- Asset lookup: match by code OR regNo ----
  const assetRows = db.prepare("SELECT id, code, regNo FROM Asset").all() as any[];
  const assetByKey = new Map<string, string>();
  for (const a of assetRows) {
    assetByKey.set(norm(a.code), a.id);
    if (a.regNo) assetByKey.set(norm(a.regNo), a.id);
  }
  const created = new Map<string, string>(); // reg -> id (new this run)
  const resolveAsset = (reg: string, site: string): string => {
    const k = norm(reg);
    const hit = assetByKey.get(k);
    if (hit) return hit;
    if (created.has(k)) return created.get(k)!;
    const id = randomUUID();
    const meter = HOURS_NEW.has(reg) ? "HOURS" : "KM";
    const ownership = HIRE_NEW.has(reg) ? "HIRED" : "OWNED";
    if (APPLY) db.prepare(`INSERT INTO "Asset" (id,code,regNo,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, reg, reg, "From site fuel sheet — set type/code", "ACTIVE", meter, ownership, now, now, OTHER_CATEGORY, null);
    assetByKey.set(k, id);
    created.set(k, id);
    bump("assetsCreated");
    notes.push(`new asset ${reg} (${meter}${ownership === "HIRED" ? ", HIRED" : ""}) — reclassify/code`);
    return id;
  };

  // ---- Per site: project + tank + replace ----
  const projByCode = new Map<string, { id: string; tankId: string }>();
  for (const [name, cfg] of Object.entries(SITES)) {
    let project = db.prepare("SELECT id FROM Project WHERE code = ? OR name = ?").get(cfg.code, name) as any;
    if (!project) {
      const id = randomUUID();
      if (APPLY) db.prepare(`INSERT INTO "Project" (id,name,code,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run(id, name, cfg.code, now, now);
      project = { id };
      bump("projectsCreated");
      notes.push(`project ${name} (${cfg.code})`);
    }
    let tank = db.prepare("SELECT id FROM BulkTank WHERE name = ?").get(cfg.tank) as any;
    if (!tank) {
      const id = randomUUID();
      if (APPLY) db.prepare(`INSERT INTO "BulkTank" (id,name,fuelKind,capacity,balance,createdAt,updatedAt,projectId) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, cfg.tank, "AUTO_DIESEL", 5000, 0, now, now, project.id);
      tank = { id };
      bump("tanksCreated");
    }
    // Replace load: clear this site's prior issues + postings
    if (APPLY) {
      bump("deletedIssues", (db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId = ?`).run(tank.id) as any).changes);
      bump("deletedAssignments", (db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId = ?`).run(project.id) as any).changes);
    }
    projByCode.set(name, { id: project.id, tankId: tank.id });
  }

  // ---- Issues + per-(site,vehicle,month) windows ----
  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  // window key = site|assetId|YYYY-MM  ->  {first,last}
  const windows = new Map<string, { site: string; assetId: string; first: string; last: string }>();

  for (const [site, day, reg, litres] of LOT02_MUTHUR_ISSUES) {
    const proj = projByCode.get(site)!;
    const assetId = resolveAsset(reg, site);
    const price = priceFor(day);
    if (APPLY) insFi.run(randomUUID(), "AUTO_DIESEL", litres, null, null, price.c, Math.round(litres * price.c), site, iso(day), now, assetId, ADMIN_ID, price.id, proj.tankId);
    bump("issues");
    const ym = day.slice(0, 7);
    const key = `${site}|${assetId}|${ym}`;
    const w = windows.get(key) ?? { site, assetId, first: day, last: day };
    if (day < w.first) w.first = day;
    if (day > w.last) w.last = day;
    windows.set(key, w);
  }

  // ---- One assignment per (site, vehicle, month) ----
  const insAssign = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  const updProj = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);
  for (const w of windows.values()) {
    const proj = projByCode.get(w.site)!;
    if (APPLY) insAssign.run(randomUUID(), w.assetId, proj.id, iso(w.first), iso(w.last, true), `${w.site} monthly fuel sheet`, now, now, ADMIN_ID);
    bump("assignments");
  }
  // Pin only the NEW assets to a current site (don't disturb existing fleet pins).
  for (const [reg, id] of created) {
    const site = LOT02_MUTHUR_ISSUES.find((r) => norm(r[2]) === reg)?.[0];
    if (site && APPLY) updProj.run(projByCode.get(site)!.id, now, id);
  }

  // ---- Audit ----
  const totalL = LOT02_MUTHUR_ISSUES.reduce((s, r) => s + r[3], 0);
  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "CREATE", "Project", projByCode.get("LOT 02")!.id, `Imported LOT 02 + MUTHUR fuel sheets: ${stats.issues ?? LOT02_MUTHUR_ISSUES.length} issues (${Math.round(totalL)} L), ${windows.size} monthly postings, ${stats.assetsCreated ?? 0} new assets`, now);

  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`=== LOT 02 + MUTHUR IMPORT ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(18)} ${v}`);
if (notes.length) { console.log("  new records:"); for (const n of notes) console.log(`   · ${n}`); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
