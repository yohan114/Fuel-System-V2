// Bring Galagedara's August 2026 into line with the site's Monthly Fuel
// Consumption Report.
//
//     node scripts/fix-galagedara-august.cjs                 # dry run
//     node scripts/fix-galagedara-august.cjs --apply
//     DB=/var/lib/fuel-system/app.db node scripts/fix-galagedara-august.cjs --apply
//
// THE TARGET. The report's "Daily Total Issue" of 23,240 L is what left the
// Galagedara tank in August: 21,640 L into machines and 1,600 L transferred to
// two other sites. Both are real outflows, and the system should hold both. The
// 1,600 L is recorded as a tank-to-tank transfer, NOT as a machine fill — the
// one existing precedent for the latter (TRANSFER-ICDP-LOT-03) invented a
// pseudo-machine and then billed a site for fuel it never burned.
//
// TANK BALANCES ARE NOT TOUCHED, deliberately. BulkTank.balance in this system
// is not a ledger: it is a single number moved only by screen entries, and the
// bulk importers never write to it. Every row this script moves or adds arrived
// through an importer, so none of them ever debited a balance. Crediting or
// debiting one now would invent fuel that no tank ever gained or lost. The
// balance is left to be settled by a physical dip, which is the only thing that
// can settle it.
//
// WHAT IT WILL NOT DO. Nothing here deletes a fuel row to make a total match.
// The single void is one fill recorded twice under two stub assets created 44
// minutes apart, and voiding it makes the gap WIDER, not narrower. Two places
// where the report is wrong and the system is right are left alone and listed
// at the end.
//
// Every change re-checks its target at run time — the row must still exist, be
// live, sit on the machine and date expected, and hold the litres expected.
// Anything that fails is skipped and reported, never forced.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
const SITE = "CEP-03F";
const SOURCE = "Monthly Fuel Consumption Report (Aug 2026), reconciled 2026-09-03";

// Colombo: a calendar day is stored at 18:30:00Z on the evening before.
const at = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600 * 1000).toISOString().replace("Z", "+00:00");
};
const day = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const rs = (cents) => "Rs " + (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
// Rs 387/L to 22 Aug, Rs 382/L from 23 Aug — the FuelPrice rows effective
// 2026-07-01 and 2026-08-23.
const priceOn = (ymd) => (ymd >= "2026-08-23" ? 38200 : 38700);

// ---------------------------------------------------------------- the plan

// 1. The 8 August day sheet, misfiled to Batticaloa by an importer that read a
//    stray "08-08-2026 (Issue Note)" tab in the Lot-02 workbook. That tab holds
//    Galagedara's issue note; Lot-02's own 8 August is the tab beside it.
const REFILE = [
  ["325-1030", 20], ["DT-56", 20], ["DT-58", 20], ["DT-67", 25], ["DT-79", 20],
  ["HEX-26", 80], ["HEX-33", 80], ["HEX-37", 80], ["HEX-42", 80], ["HEX-45", 80],
  ["MG-04", 50], ["SC-14", 41], ["SR-12", 50], ["SR-13", 50], ["ZB-4606", 40],
];
// The note's "MG-04" is MG-07 (reg ZA-4344): its meter 10826.5 falls between
// MG-07's 7 Aug 10821 and 10 Aug 10831.8, and the note's own "Prev: 10820.8"
// matches MG-07. MG-04 is a grader at Mihintale that has drawn no fuel since
// January, and the misfiling left it posted to Batticaloa open-endedly.
const REPOINT = { "MG-04": "MG-07" };

// 2. Quantities that exist but were transcribed wrongly. Each is [code, date,
//    expected-now, corrected, evidence].
const EDITS = [
  ["HEX-23", "2026-08-27", 24, 242, "27/08 sheet row 14 reads 242 (meters 134.7/130); a dropped trailing digit"],
  ["HEX-26", "2026-08-26", 75, 256, "26/08 sheet row 09 quantity blotted, circled (256) in Consumption"],
  ["TM-14", "2026-08-21", 20, 90, "21/08 sheet row 15 reads 90; sheet totals 1,162 = the report's 21 Aug total"],
  ["HEX-42", "2026-08-30", 190, 199, "30/08 sheet row 12 reads 199 (meters 5572/5561)"],
  ["HEX-26", "2026-08-31", 130, 132, "report row for 31 Aug reads 132"],
  ["DT-67", "2026-08-11", 20, 153, "11/08 sheet row 09 quantity blotted, circled (153) in Consumption"],
  ["MG-07", "2026-08-07", 80, 50, "07/08 sheet: flat-topped 5, and the sheet totals 704 with 50 (the report's figure)"],
  ["HEX-26", "2026-08-09", 108, 100, "09/08 sheet 'Issued By' box totals 843, which needs HEX-26 at 100"],
  ["DT-79", "2026-08-09", 28, 20, "09/08 sheet, same 843 total"],
  ["DT-56", "2026-08-12", 24, 21, "12/08 sheet, circled (21)"],
  ["WG-13", "2026-08-19", 25, 23, "19/08 sheet reads 23"],
  ["D4D-02", "2026-08-05", 35, 30, "report reads 30"],
  ["PE-3723", "2026-08-22", 20, 30, "report reads 30"],
  ["ZB-4606", "2026-08-29", 20, 25, "report reads 25"],
];

// 3. Fills on the site's paperwork that were never typed in. No meter readings
//    are invented — where the sheet gives one it is carried, otherwise null.
const ADDS = [
  // the 1-2 September typing session stopped after 11 of the report's 17 rows
  ["HEX-42", "2026-08-31", 110, null, "31 Aug report row; no daily sheet was ever received"],
  ["LB-21", "2026-08-31", 30, null, "31 Aug report row"],
  ["DT-70", "2026-08-31", 20, null, "31 Aug report row"],
  ["DAI-9757", "2026-08-31", 27, null, "31 Aug report row"],
  ["41-7225", "2026-08-31", 38, null, "31 Aug report row"],
  ["D4D-02", "2026-08-31", 30, null, "31 Aug report row"],
  // small fills present on the photographed daily sheets
  ["41-7225", "2026-08-22", 39, null, "22/08 sheet"],
  ["41-7225", "2026-08-27", 23, null, "27/08 sheet row 07"],
  ["DAI-9757", "2026-08-24", 17, 255, "24/08 sheet; meter chain 93 -> 255 -> 305 -> 429"],
  ["DAI-9757", "2026-08-27", 6, 429, "27/08 sheet row 04"],
  ["DAI-9762", "2026-08-28", 11, 282, "28/08 sheet"],
  // 15-18 August: no daily sheets exist, the report is the only source. Its own
  // tank ledger corroborates a tank run down to empty and not refilled until the 19th.
  ["HEX-42", "2026-08-15", 30, null, "report only; no daily sheet for 15-18 Aug"],
  ["DB-04", "2026-08-18", 20, null, "report only; no daily sheet for 15-18 Aug"],
];

// 4. One fill, two stub assets, created 44 minutes apart by two import runs.
//    Each stub has exactly one fuel row in its whole lifetime. The report has a
//    single row. GE-M47 keeps it — that is the label the site wrote. GE-47 is
//    the stray. Neither is merged into the real GE-147, which sits at Badalgama
//    and carries its own draft August bill there; that identity needs the plate.
const VOID = [["GE-47", "2026-08-05", 172, "duplicate of the same fill held by GE-M47"]];

// 5. The two transfers, recorded as transfers.
const TRANSFERS = [
  ["2026-08-20", 800, "CEP-03W", "Transfer to CEP-03 Wadakada (report row 181)"],
  ["2026-08-23", 400, "CEP-03W", "Transfer to CEP-03 Wadakada (report row 181)"],
  ["2026-08-24", 200, "CEP-03W", "Transfer to CEP-03 Wadakada (report row 181)"],
  ["2026-08-24", 200, "CEP-03E", "Transfer to Package E (report row 182)"],
];

// ------------------------------------------------------------------- setup
const db = new Database(DB_PATH);
console.log(`\n=== Galagedara August 2026 (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();
if (!admin) throw new Error("no ADMIN user to attribute these changes to");

const tank = db.prepare(`SELECT t.id, t.name FROM BulkTank t JOIN Project p ON p.id=t.projectId WHERE p.code=?`).get(SITE);
if (!tank) throw new Error(`no tank for ${SITE}`);

const assetOf = (code) => {
  const rows = db.prepare("SELECT id, code, meterType FROM Asset WHERE code=?").all(code);
  if (rows.length !== 1) throw new Error(`${code}: expected exactly one asset, found ${rows.length}`);
  return rows[0];
};
const priceIdOn = (ymd) => {
  const p = db.prepare(`SELECT id, pricePerLitre FROM FuelPrice
    WHERE fuelKind='AUTO_DIESEL' AND effectiveFrom <= ? ORDER BY effectiveFrom DESC LIMIT 1`).get(at(ymd));
  return p;
};
const liveRows = (code, ymd) => db.prepare(`
  SELECT f.* FROM FuelIssue f JOIN Asset a ON a.id=f.assetId
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE p.code=? AND f.voided=0 AND a.code=?
    AND date(f.issueDate,'+5 hours','+30 minutes')=?`).all(SITE, code, ymd);

const totalNow = () => db.prepare(`
  SELECT ROUND(SUM(f.litres),2) L, COUNT(*) n FROM FuelIssue f
  JOIN BulkTank t ON t.id=f.bulkTankId JOIN Project p ON p.id=t.projectId
  WHERE p.code=? AND f.voided=0
    AND f.issueDate >= '2026-07-31T18:30:00.000+00:00'
    AND f.issueDate <  '2026-08-31T18:30:00.000+00:00'`).get(SITE);

const before = totalNow();
console.log(`  Galagedara tank, August, before: ${before.n} issues, ${before.L} L\n`);

const ops = [];
const skipped = [];
let delta = 0;

// ---------------------------------------------------------------- 1. refile
const battiRows = db.prepare(`
  SELECT f.id, f.litres, a.code, a.id assetId FROM FuelIssue f
  JOIN Asset a ON a.id=f.assetId JOIN BulkTank t ON t.id=f.bulkTankId
  JOIN Project p ON p.id=t.projectId
  WHERE p.code='BATTI-02' AND f.voided=0
    AND date(f.issueDate,'+5 hours','+30 minutes')='2026-08-08'`).all();

for (const [code, litres] of REFILE) {
  const hit = battiRows.filter((r) => r.code === code && r.litres === litres);
  if (hit.length !== 1) { skipped.push([`refile ${code}`, `expected 1 row of ${litres} L on the Batti tank, found ${hit.length}`]); continue; }
  const dest = REPOINT[code] ? assetOf(REPOINT[code]) : null;
  ops.push({ kind: "refile", id: hit[0].id, code, litres, toAsset: dest, note: REPOINT[code] ? `tank -> Galagedara, machine -> ${REPOINT[code]}` : "tank -> Galagedara" });
  delta += litres;
}

// ------------------------------------------------------------------ 2. edits
for (const [code, ymd, expect, corrected, why] of EDITS) {
  const rows = liveRows(code, ymd);
  const hit = rows.filter((r) => r.litres === expect);
  if (hit.length !== 1) { skipped.push([`edit ${code} ${ymd}`, `expected 1 live row of ${expect} L, found ${hit.length}${rows.length ? ` (that day holds ${rows.map((r) => r.litres).join("+")})` : " (no rows that day)"}`]); continue; }
  ops.push({ kind: "edit", id: hit[0].id, code, ymd, from: expect, to: corrected, price: hit[0].pricePerLitre, why });
  delta += corrected - expect;
}

// ------------------------------------------------------------------- 3. adds
for (const [code, ymd, litres, meter, why] of ADDS) {
  const a = assetOf(code);
  const dupe = liveRows(code, ymd).filter((r) => r.litres === litres);
  if (dupe.length) { skipped.push([`add ${code} ${ymd} ${litres}L`, `a row of exactly this size already exists (${dupe[0].id.slice(0, 8)}) — refusing to double it`]); continue; }
  const p = priceIdOn(ymd);
  if (!p || p.pricePerLitre !== priceOn(ymd)) { skipped.push([`add ${code} ${ymd}`, `price lookup gave ${p ? p.pricePerLitre : "nothing"}, expected ${priceOn(ymd)}`]); continue; }
  ops.push({ kind: "add", asset: a, code, ymd, litres, meter, price: p, why });
  delta += litres;
}

// ------------------------------------------------------------------- 4. void
for (const [code, ymd, litres, why] of VOID) {
  const hit = liveRows(code, ymd).filter((r) => r.litres === litres);
  if (hit.length !== 1) { skipped.push([`void ${code} ${ymd}`, `expected 1 live row of ${litres} L, found ${hit.length}`]); continue; }
  ops.push({ kind: "void", id: hit[0].id, code, ymd, litres, why });
  delta -= litres;
}

// --------------------------------------------------------------- 5. transfers
for (const [ymd, litres, destCode, why] of TRANSFERS) {
  const dest = db.prepare(`SELECT t.id, t.name FROM BulkTank t JOIN Project p ON p.id=t.projectId WHERE p.code=?`).get(destCode);
  if (!dest) { skipped.push([`transfer ${ymd} ${litres}L`, `no tank for ${destCode}`]); continue; }
  const dupe = db.prepare(`SELECT id FROM BulkRequest WHERE sourceTankId=? AND bulkTankId=? AND requestedLitres=? AND date(createdAt)=?`).get(tank.id, dest.id, litres, ymd);
  if (dupe) { skipped.push([`transfer ${ymd} ${litres}L -> ${destCode}`, `already recorded (${dupe.id.slice(0, 8)})`]); continue; }
  ops.push({ kind: "transfer", ymd, litres, dest, destCode, why });
}

// ------------------------------------------------------------------ report
const show = (k, fn) => {
  const list = ops.filter((o) => o.kind === k);
  if (!list.length) return;
  console.log(`  ${list.length} ${k.toUpperCase()}${list.length > 1 ? "" : ""}`);
  for (const o of list) console.log("    " + fn(o));
  console.log("");
};
show("refile", (o) => `${o.code.padEnd(10)}8 Aug  ${String(o.litres).padStart(4)} L   ${o.note}`);
show("edit", (o) => `${o.code.padEnd(10)}${o.ymd.slice(5)}  ${String(o.from).padStart(4)} -> ${String(o.to).padEnd(5)}(${o.to - o.from > 0 ? "+" : ""}${o.to - o.from} L)  ${o.why}`);
show("add", (o) => `${o.code.padEnd(10)}${o.ymd.slice(5)}  ${String(o.litres).padStart(4)} L   meter ${o.meter ?? "-"}   ${o.why}`);
show("void", (o) => `${o.code.padEnd(10)}${o.ymd.slice(5)}  ${String(o.litres).padStart(4)} L   ${o.why}`);
show("transfer", (o) => `${o.ymd.slice(5)}  ${String(o.litres).padStart(5)} L  -> ${o.destCode.padEnd(9)}${o.why}`);

if (skipped.length) {
  console.log("  SKIPPED — target did not match, nothing forced:");
  for (const [what, why] of skipped) console.log(`    ${what.padEnd(30)}${why}`);
  console.log("");
}

const transferL = ops.filter((o) => o.kind === "transfer").reduce((s, o) => s + o.litres, 0);
console.log(`  machine fuel change : ${delta > 0 ? "+" : ""}${Math.round(delta * 100) / 100} L`);
console.log(`  Galagedara August   : ${before.L} -> ${Math.round((before.L + delta) * 100) / 100} L (machine fuel)`);
console.log(`  transfers recorded  : ${transferL} L`);
console.log(`  TOTAL OUT OF TANK   : ${Math.round((before.L + delta + transferL) * 100) / 100} L`);
console.log(`  tank balances       : UNTOUCHED (these rows never moved one)\n`);

if (!APPLY) {
  console.log("DRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

// ------------------------------------------------------------------- apply
const now = new Date().toISOString().replace("Z", "+00:00");
const audit = (entity, entityId, summary) =>
  db.prepare(`INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), admin.id, "UPDATE", entity, entityId, summary, now);

db.transaction(() => {
  for (const o of ops) {
    if (o.kind === "refile") {
      if (o.toAsset) db.prepare("UPDATE FuelIssue SET bulkTankId=?, assetId=? WHERE id=?").run(tank.id, o.toAsset.id, o.id);
      else db.prepare("UPDATE FuelIssue SET bulkTankId=? WHERE id=?").run(tank.id, o.id);
      audit("FuelIssue", o.id,
        `Re-filed to Galagedara: ${o.code} ${o.litres} L on 2026-08-08. The Lot-02 workbook carries a stray ` +
        `"08-08-2026 (Issue Note)" tab holding Galagedara's issue note (15 rows, 736 L); the importer read it ` +
        `as Lot-02's. ${o.note}. Tank balances deliberately not adjusted — the importer never moved one.`);
    } else if (o.kind === "edit") {
      db.prepare("UPDATE FuelIssue SET litres=?, totalCost=? WHERE id=?").run(o.to, Math.round(o.to * o.price), o.id);
      audit("FuelIssue", o.id, `Corrected ${o.code} ${o.ymd}: ${o.from} L -> ${o.to} L (${rs(Math.round(o.to * o.price))}). ${o.why}. Source: ${SOURCE}.`);
    } else if (o.kind === "add") {
      const id = randomUUID();
      db.prepare(`INSERT INTO FuelIssue
        (id,fuelKind,litres,meterReading,readingType,pricePerLitre,totalCost,source,issueDate,createdAt,
         assetId,issuedById,fuelPriceId,bulkTankId,voided,importKey)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`).run(
        id, "AUTO_DIESEL", o.litres, o.meter, o.meter ? o.asset.meterType : null,
        o.price.pricePerLitre, Math.round(o.litres * o.price.pricePerLitre), SOURCE,
        at(o.ymd), now, o.asset.id, admin.id, o.price.id, tank.id,
        `galagedara-aug-recon:${o.code}:${o.ymd}:${o.litres}`);
      audit("FuelIssue", id, `Added ${o.code} ${o.litres} L on ${o.ymd} at Galagedara. ${o.why}. Source: ${SOURCE}.`);
    } else if (o.kind === "void") {
      db.prepare("UPDATE FuelIssue SET voided=1, voidedAt=? WHERE id=?").run(now, o.id);
      audit("FuelIssue", o.id,
        `Voided ${o.code} ${o.litres} L on ${o.ymd}: ${o.why}. GE-47 and GE-M47 are stub assets created 44 minutes ` +
        `apart by two import runs, each holding exactly one fuel row in its lifetime, for a fill the site recorded once. ` +
        `Tank balance deliberately not credited — this row never debited one.`);
    } else if (o.kind === "transfer") {
      const id = randomUUID();
      db.prepare(`INSERT INTO BulkRequest
        (id,fuelKind,requestedLitres,status,createdAt,updatedAt,bulkTankId,sourceType,sourceTankId,
         requestedById,reviewedById,reviewedAt,reviewNote)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, "AUTO_DIESEL", o.litres, "APPROVED", at(o.ymd), now, o.dest.id, "TANK", tank.id,
        admin.id, admin.id, now, `${o.why}. Reconciled from the site's Monthly Fuel Consumption Report.`);
      audit("BulkRequest", id,
        `Recorded ${o.litres} L transferred from Galagedara to ${o.destCode} on ${o.ymd}. ${o.why}. ` +
        `Recorded as a tank-to-tank transfer, not as a machine fill, so no site is billed for fuel it did not burn. ` +
        `Tank balances deliberately not adjusted here — the receiving site's stock book has not been seen.`);
    }
  }
})();

db.pragma("wal_checkpoint(TRUNCATE)");

const after = totalNow();
console.log(`  DONE. Galagedara August: ${after.n} issues, ${after.L} L machine fuel`);
console.log(`        + ${transferL} L transferred out = ${Math.round((after.L + transferL) * 100) / 100} L out of the tank\n`);
console.log(`  Re-generate the August drafts so the bills pick this up.`);
console.log(`  Left alone on purpose — the report is wrong and the system is right:`);
console.log(`    26 Aug HEX-23  report 130 L is the meter copied into the litres cell; the sheet's circled (60) stands.`);
console.log(`    19 Aug HEX-26  report 150 L is HEX-37's figure on the wrong line; the machine was filled twice (50+190).\n`);
db.close();
