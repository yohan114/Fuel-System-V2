import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";
import { GALAGEDARA_ISSUES, GALAGEDARA_RECEIPTS } from "./data/galagedara_stock";

// Load the CEP-03F Galagedara diesel tank from the authoritative digital stock
// book (scripts/data/galagedara_stock.ts, from the client's Diesel_stock_book
// .xlsx, 11 May – 6 Jul 2026). Reconciled: received 4,586 − issued 4,079 = 507 L.
//
// This is a REPLACE load — it clears any existing issues / receipts / postings
// for the tank first, so re-running always lands the sheet exactly (and it
// supersedes the earlier PDF-transcribed load). Every Galagedara vehicle (hired
// D4D and the survey/other vehicles included) is posted to the site.
//
// Dry-run by default; --apply writes in one transaction.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const PROJECT_NAME = "CEP-03F Galagedara";
const PROJECT_CODE = "CEP-03F";
const TANK_NAME = "CEP-03F Galagedara";
const TANK_CAPACITY = 2500;
const TANK_CLOSING = GALAGEDARA_RECEIPTS.reduce((s, r) => s + r[3], 0) - GALAGEDARA_ISSUES.reduce((s, i) => s + i[2], 0); // 337
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const OTHER_CATEGORY = "5caa3321-da5d-4374-aa0d-5d0fdb84ed4b";

const iso = (day: string, endOfDay = false) =>
  new Date(`${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+05:30`).toISOString();

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
const notes: string[] = [];

db.exec("BEGIN");
db.pragma("defer_foreign_keys = ON");
try {
  const now = new Date().toISOString();

  // ---- 1. Project + tank (create or reuse) ----
  let project = db.prepare("SELECT id FROM Project WHERE code = ? OR name = ?").get(PROJECT_CODE, PROJECT_NAME) as any;
  if (!project) {
    const id = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "Project" (id,name,code,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run(id, PROJECT_NAME, PROJECT_CODE, now, now);
    project = { id };
    bump("projectCreated");
  }
  let tank = db.prepare("SELECT id FROM BulkTank WHERE name = ?").get(TANK_NAME) as any;
  if (!tank) {
    const id = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "BulkTank" (id,name,fuelKind,capacity,balance,createdAt,updatedAt,projectId) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, TANK_NAME, "AUTO_DIESEL", TANK_CAPACITY, TANK_CLOSING, now, now, project.id);
    tank = { id };
    bump("tankCreated");
  } else if (APPLY) {
    db.prepare(`UPDATE "BulkTank" SET balance=?, updatedAt=? WHERE id=?`).run(TANK_CLOSING, now, tank.id);
  }

  // ---- 2. Clear prior Galagedara data (replace load) ----
  if (APPLY) {
    bump("deletedIssues", (db.prepare(`DELETE FROM "FuelIssue" WHERE bulkTankId = ?`).run(tank.id) as any).changes);
    bump("deletedReceipts", (db.prepare(`DELETE FROM "BulkRequest" WHERE bulkTankId = ?`).run(tank.id) as any).changes);
    bump("deletedAssignments", (db.prepare(`DELETE FROM "AssetAssignment" WHERE projectId = ?`).run(project.id) as any).changes);
  }

  // ---- 3. Resolve / create assets ----
  const assetByCode = new Map((db.prepare("SELECT id, code FROM Asset").all() as any[]).map((a) => [a.code.toUpperCase(), a.id]));
  const resolveAsset = (code: string): string => {
    const hit = assetByCode.get(code.toUpperCase());
    if (hit) return hit;
    const id = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "Asset" (id,code,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId,projectId) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, code, "From stock book — set type", "ACTIVE", "HOURS", "OWNED", now, now, OTHER_CATEGORY, project.id);
    assetByCode.set(code.toUpperCase(), id);
    bump("assetsCreated");
    notes.push(`created asset ${code} (Other — reclassify)`);
    return id;
  };

  // ---- 4. Per-vehicle window (for assignments) ----
  const window = new Map<string, { first: string; last: string }>();
  for (const [day, code] of GALAGEDARA_ISSUES) {
    const w = window.get(code) ?? { first: day, last: day };
    if (day < w.first) w.first = day;
    if (day > w.last) w.last = day;
    window.set(code, w);
  }

  // ---- 5. Prices ----
  const prices = db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all() as any[];
  const priceFor = (day: string) => prices.find((p) => p.d <= day) ?? prices[prices.length - 1];

  // ---- 6. Issues ----
  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  for (const [day, code, litres] of GALAGEDARA_ISSUES) {
    const price = priceFor(day);
    if (APPLY) insFi.run(randomUUID(), "AUTO_DIESEL", litres, null, null, price.c, Math.round(litres * price.c), TANK_NAME, iso(day), now, resolveAsset(code), ADMIN_ID, price.id, tank.id);
    bump("issues");
  }

  // ---- 7. Receipts (approved bulk replenishments) ----
  const insReq = db.prepare(`INSERT INTO "BulkRequest" (id,fuelKind,requestedLitres,status,createdAt,updatedAt,bulkTankId,requestedById,reviewedById,reviewedAt,reviewNote) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [day, src, grn, litres] of GALAGEDARA_RECEIPTS) {
    if (APPLY) insReq.run(randomUUID(), "AUTO_DIESEL", litres, "APPROVED", iso(day), iso(day), tank.id, ADMIN_ID, ADMIN_ID, iso(day), `Received from ${src}${grn ? ` (${grn})` : ""}`);
    bump("receipts");
  }

  // ---- 8. Allocations: assign + post every Galagedara vehicle to the site ----
  const insAssign = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  const updProj = db.prepare(`UPDATE "Asset" SET projectId=?, updatedAt=? WHERE id=?`);
  for (const [code, w] of window) {
    const assetId = resolveAsset(code);
    if (APPLY) {
      insAssign.run(randomUUID(), assetId, project.id, iso(w.first), iso(w.last, true), "CEP-03F Galagedara stock book", now, now, ADMIN_ID);
      updProj.run(project.id, now, assetId);
    }
    bump("vehiclesPosted");
  }

  // ---- 9. Audit ----
  const issuedL = GALAGEDARA_ISSUES.reduce((s, i) => s + i[2], 0);
  const recdL = GALAGEDARA_RECEIPTS.reduce((s, r) => s + r[3], 0);
  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "UPDATE", "BulkTank", tank.id, `Reloaded CEP-03F Galagedara from stock book: ${GALAGEDARA_ISSUES.length} issues (${issuedL} L), ${GALAGEDARA_RECEIPTS.length} top-ups (${recdL} L), balance ${TANK_CLOSING} L, ${window.size} vehicles`, now);

  console.log(`\nReconcile: received ${recdL} − issued ${issuedL} = ${recdL - issuedL} L (balance set to ${TANK_CLOSING})`);
  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`=== GALAGEDARA STOCK-BOOK LOAD ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(18)} ${v}`);
if (notes.length) { console.log("  notes:"); for (const n of notes) console.log(`   · ${n}`); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
