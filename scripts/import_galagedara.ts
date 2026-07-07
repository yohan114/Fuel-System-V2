import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import path from "path";

// Digitise the CEP-03F Galagedara diesel bulk-tank ledger (Edward & Christie
// stock cards ROL 001–008, 11 May – 5 Jul 2026). Creates the project + tank,
// resolves/creates the 15 machines, allocates them to the site, and loads the
// 21 top-ups and 109 issues. Every figure was reconciled against each card's
// running cumulative + balance columns (received 4,185 − issued 3,801 = 384 L).
//
// Idempotent: keyed on the tank name — if the tank already carries issues the
// run is a no-op. Dry-run by default; --apply writes in one transaction.

const APPLY = process.argv.includes("--apply");
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const PROJECT_NAME = "CEP-03F Galagedara";
const PROJECT_CODE = "CEP-03F";
const TANK_NAME = "CEP-03F Galagedara";
const TANK_CAPACITY = 2500;
const TANK_CLOSING = 384;            // book closing = received − issued (14/06 HEX-45 = 40)
const ADMIN_ID = "023cee32-d4e2-4b39-b868-11fd1ce98181";
const OTHER_CATEGORY = "5caa3321-da5d-4374-aa0d-5d0fdb84ed4b";

// [dd/mm, code, litres, note] — codes are already the resolved asset codes.
const issues: [string, string, number, string][] = [
  ["11/05","ZB-1980",20,""],["14/05","ZB-1980",60,""],["20/05","ZB-1980",60,""],["23/05","ZB-1980",40,""],["24/05","ZB-1980",60,""],
  ["04/06","ZB-1980",20,""],["04/06","D4D-01",40,""],["05/06","ZB-1980",20,""],["05/06","D4D-01",40,""],
  ["06/06","59-5421",5,""],["08/06","59-5421",10,""],["08/06","D4D-02",60,""],["09/06","D4D-02",20,""],["09/06","HEX-45",60,""],
  ["10/06","HEX-45",40,""],["10/06","ZB-1980",30,""],["10/06","D4D-02",60,""],["12/06","HEX-45",60,""],["12/06","59-5421",10,""],
  ["13/06","D4D-02",20,""],["13/06","59-5421",10,""],["14/06","D4D-03",40,""],["14/06","ZB-1980",20,""],
  ["14/06","HEX-45",40,"corrected to 40 L per site (card total had used 60)"],["15/06","HEX-45",30,""],["15/06","D4D-02",30,""],["15/06","D4D-03",30,""],["15/06","59-5421",10,""],
  ["16/06","HEX-45",40,""],["16/06","D4D-03",20,""],["16/06","59-5421",10,""],["16/06","HEX-45",40,""],["17/06","HEX-01",80,""],
  ["17/06","HEX-45",80,""],["17/06","59-5421",10,""],["19/06","ZB-1980",40,""],
  ["19/06","59-5421",10,""],["20/06","D4D-02",20,""],["20/06","HEX-45",60,""],["20/06","D4D-03",40,""],["20/06","PJ-6376",10,""],
  ["21/06","D4D-02",40,""],["21/06","D4D-03",40,""],["21/06","HEX-45",70,""],["21/06","HEX-01",70,""],["21/06","59-5421",10,""],
  ["21/06","PJ-6376",10,""],["22/06","SR-13",20,""],["22/06","D4D-02",40,""],["22/06","PJ-6376",20,""],["22/06","59-5421",10,""],["23/06","HEX-45",80,""],
  ["23/06","HEX-01",50,""],["23/06","PJ-6376",10,""],["24/06","HEX-01",60,""],["24/06","MG-07",30,""],["24/06","59-5421",10,""],
  ["24/06","PJ-6376",20,""],["25/06","D4D-03",30,""],["25/06","HEX-45",60,""],["25/06","HEX-01",80,""],["25/06","PJ-6376",10,""],
  ["25/06","SR-13",30,""],["26/06","MG-07",30,""],["26/06","PJ-6376",20,""],["26/06","59-5421",10,""],["26/06","D4D-02",40,""],["26/06","HEX-01",80,""],
  ["26/06","HEX-45",80,""],["27/06","HEX-01",40,""],["27/06","HEX-45",60,""],["27/06","D4D-02",30,""],["27/06","PE-3723",20,'no cylinder plate'],
  ["30/06","HEX-01",40,""],["30/06","59-5421",10,""],["30/06","PJ-6376",10,"card wrote DJ-6376"],["01/07","MG-07",20,""],["01/07","HEX-45",80,""],
  ["01/07","HEX-01",80,"59-5421 struck out → HEX-01"],["01/07","LB-21",20,"DJ-6376 struck out → LB-21"],["01/07","D4D-02",20,""],["01/07","PE-3723",10,""],["01/07","SR-13",20,""],
  ["01/07","LB-21",3,"repair workshop"],["02/07","HEX-45",50,""],["02/07","HEX-01",50,""],["02/07","MG-07",30,"card reads MG-01"],["02/07","LO-7181",10,""],
  ["02/07","D4D-03",30,""],["02/07","D4D-02",30,""],["02/07","59-5421",10,""],["02/07","PJ-6376",20,"card wrote DJ-6376"],["03/07","HEX-01",60,""],
  ["03/07","HEX-45",60,""],["03/07","MG-07",30,""],["03/07","D4D-02",40,""],["03/07","D4D-03",40,""],["03/07","SR-13",20,""],
  ["03/07","LO-7181",20,""],["03/07","59-5421",10,""],["03/07","LB-21",23,""],["05/07","LB-25",30,""],["05/07","HEX-45",80,""],
  ["05/07","HEX-01",80,""],["05/07","MG-07",20,""],["05/07","D4D-03",30,""],["05/07","HEX-26",60,""],["05/07","SR-13",20,""],["05/07","PJ-6376",20,"card wrote DJ-6376"],
];

// [dd/mm, source, grn, litres]
const receipts: [string, string, string, number][] = [
  ["11/05","CEP-03 Site","47914",20],["14/05","Filling Station","",60],["20/05","Filling Station","",60],["23/05","Filling Station","B-2273",40],
  ["24/05","Filling Station","B-2287",60],["04/06","Filling Station","",120],["06/06","CEP-03 Site","47932",200],["06/06","Filling Station","",5],
  ["08/06","CEP-03 Site","47938",200],["12/06","CEP-03 Site","47946",200],["15/06","CEP-03 Site","",200],["16/06","CEP-03 Site","48512",200],
  ["17/06","CEP-03 Site","48517",200],["18/06","CEP-03 Site","48521",200],["22/06","CEP-03 Site","48528",400],["24/06","CEP-03 Site","48537",400],
  ["26/06","CEP-03 Site","46544",400],["30/06","CEP-03 Site","46549",200],["02/07","Filling Station","p/cash",20],["02/07","CEP-03 Site","",400],["03/07","CEP-03 Site","",600],
];

// Machines that must be created if missing (the rest already exist by code).
// D4D-01/02/03 were already added to the hire fleet.
const NEW_UNCLASSIFIED = new Set(["ZB-1980", "59-5421", "PE-3723"]);

const iso = (dmy: string, endOfDay = false) => {
  const [d, m] = dmy.split("/");
  const t = endOfDay ? "23:59:59.999" : "00:00:00.000";
  return new Date(`2026-${m}-${d}T${t}+05:30`).toISOString();
};

const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
const notes: string[] = [];

db.exec("BEGIN");
db.pragma("defer_foreign_keys = ON");
try {
  const now = new Date().toISOString();

  // ---- Guard: already imported? ----
  const existingTank = db.prepare("SELECT id FROM BulkTank WHERE name = ?").get(TANK_NAME) as any;
  if (existingTank) {
    const cnt = (db.prepare("SELECT COUNT(*) c FROM FuelIssue WHERE bulkTankId = ?").get(existingTank.id) as any).c;
    if (cnt > 0) {
      console.log(`Tank "${TANK_NAME}" already has ${cnt} issues — nothing to do (idempotent).`);
      db.exec("ROLLBACK");
      process.exit(0);
    }
  }

  // ---- 1. Project ----
  let project = db.prepare("SELECT id FROM Project WHERE code = ? OR name = ?").get(PROJECT_CODE, PROJECT_NAME) as any;
  if (!project) {
    const id = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "Project" (id,name,code,createdAt,updatedAt) VALUES (?,?,?,?,?)`).run(id, PROJECT_NAME, PROJECT_CODE, now, now);
    project = { id };
    bump("project");
    notes.push(`created project ${PROJECT_CODE} — ${PROJECT_NAME}`);
  } else notes.push(`project ${PROJECT_CODE} already exists`);

  // ---- 2. Bulk tank ----
  let tankId = existingTank?.id;
  if (!tankId) {
    tankId = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "BulkTank" (id,name,fuelKind,capacity,balance,createdAt,updatedAt,projectId) VALUES (?,?,?,?,?,?,?,?)`)
      .run(tankId, TANK_NAME, "AUTO_DIESEL", TANK_CAPACITY, TANK_CLOSING, now, now, project.id);
    bump("tank");
    notes.push(`created tank ${TANK_NAME} (AUTO_DIESEL, cap ${TANK_CAPACITY} L, balance ${TANK_CLOSING} L)`);
  }

  // ---- 3. Resolve / create assets ----
  const assetByCode = new Map((db.prepare("SELECT id, code FROM Asset").all() as any[]).map((a) => [a.code.toUpperCase(), a.id]));
  const resolveAsset = (code: string): string => {
    const hit = assetByCode.get(code.toUpperCase());
    if (hit) return hit;
    if (!NEW_UNCLASSIFIED.has(code)) throw new Error(`Unexpected missing asset ${code}`);
    const id = randomUUID();
    if (APPLY) db.prepare(`INSERT INTO "Asset" (id,code,typeLabel,status,meterType,ownership,createdAt,updatedAt,categoryId) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, code, "Unclassified — set type", "ACTIVE", "HOURS", "OWNED", now, now, OTHER_CATEGORY);
    assetByCode.set(code.toUpperCase(), id);
    bump("asset");
    notes.push(`created asset ${code} (Other — reclassify)`);
    return id;
  };
  const codes = [...new Set(issues.map((i) => i[1]))];
  for (const c of codes) resolveAsset(c);

  // ---- 4. Allocations (per-vehicle window at this tank) ----
  const window = new Map<string, { first: string; last: string }>();
  for (const [dmy, code] of issues) {
    const w = window.get(code) ?? { first: dmy, last: dmy };
    if (iso(dmy) < iso(w.first)) w.first = dmy;
    if (iso(dmy) > iso(w.last)) w.last = dmy;
    window.set(code, w);
  }
  const insAssign = db.prepare(`INSERT INTO "AssetAssignment" (id,assetId,projectId,startDate,endDate,note,createdAt,updatedAt,createdById) VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const [code, w] of window) {
    if (APPLY) insAssign.run(randomUUID(), resolveAsset(code), project.id, iso(w.first), iso(w.last, true), "CEP-03F Galagedara tank ledger", now, now, ADMIN_ID);
    bump("assignment");
  }

  // ---- 5. Receipts (as approved bulk replenishments) ----
  const insReq = db.prepare(`INSERT INTO "BulkRequest" (id,fuelKind,requestedLitres,status,createdAt,updatedAt,bulkTankId,requestedById,reviewedById,reviewedAt,reviewNote) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [dmy, src, grn, litres] of receipts) {
    const note = `Received from ${src}${grn ? ` (${grn})` : ""}`;
    if (APPLY) insReq.run(randomUUID(), "AUTO_DIESEL", litres, "APPROVED", iso(dmy), iso(dmy), tankId, ADMIN_ID, ADMIN_ID, iso(dmy), note);
    bump("receipt");
  }

  // ---- 6. Fuel issues ----
  const prices = (db.prepare("SELECT id, substr(effectiveFrom,1,10) d, pricePerLitre c FROM FuelPrice WHERE fuelKind='AUTO_DIESEL' ORDER BY d DESC").all() as any[]);
  const priceFor = (dateISO: string) => {
    const day = dateISO.slice(0, 10);
    // dateISO is a UTC instant of Colombo-midnight; compare on the calendar date
    const cal = new Date(dateISO); cal.setUTCHours(cal.getUTCHours() + 6); const calDay = cal.toISOString().slice(0, 10);
    return prices.find((p) => p.d <= calDay) ?? prices[prices.length - 1];
  };
  const insFi = db.prepare(`INSERT INTO "FuelIssue" (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,assetId,issuedById,fuelPriceId,bulkTankId,voided) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`);
  let issuedTotal = 0;
  for (const [dmy, code, litres] of issues) {
    const when = iso(dmy);
    const price = priceFor(when);
    const cost = Math.round(litres * price.c);
    if (APPLY) insFi.run(randomUUID(), "AUTO_DIESEL", litres, null, null, price.c, cost, TANK_NAME, when, now, resolveAsset(code), ADMIN_ID, price.id, tankId);
    issuedTotal += litres;
    bump("issue");
  }

  // ---- 7. Audit ----
  if (APPLY) db.prepare(`INSERT INTO "AuditLog" (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), ADMIN_ID, "CREATE", "BulkTank", tankId, `Imported CEP-03F Galagedara diesel ledger: ${issues.length} issues (${issuedTotal} L), ${receipts.length} top-ups, ${window.size} vehicles`, now);

  const recdTotal = receipts.reduce((s, r) => s + r[3], 0);
  console.log(`\nReconcile: received ${recdTotal} − issued ${issuedTotal} = ${recdTotal - issuedTotal} L (tank balance set to ${TANK_CLOSING})`);

  if (APPLY) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`\n=== GALAGEDARA IMPORT ${APPLY ? "APPLIED" : "DRY-RUN (rolled back)"} ===`);
for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(11)} ${v}`);
if (notes.length) { console.log("  notes:"); for (const n of notes) console.log(`   · ${n}`); }
if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
db.close();
