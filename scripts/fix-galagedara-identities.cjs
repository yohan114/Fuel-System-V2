// The four remaining Galagedara identity splits, settled against the site's
// Monthly Fuel Consumption Report.
//
//     node scripts/fix-galagedara-identities.cjs
//     node scripts/fix-galagedara-identities.cjs --apply
//     DB=/var/lib/fuel-system/app.db node scripts/fix-galagedara-identities.cjs --apply
//
// None of these moves a litre into or out of a tank. Every one moves fuel from
// the machine it was wrongly recorded against to the machine that burned it,
// which changes what each SITE is billed — so each carries its site posting
// across with it. Moving fuel without the posting is how 171 L of Galagedara
// diesel ended up charged to Badalgama on 41-7225.
//
// HOW THE REPORT NAMES A MACHINE. Column B is the registration plate, column C
// the fleet code. Two rows prove the convention beyond argument: row 114 is
// "ZA-2608 / LB-07" and row 117 is "ZB-1980 / LB-21", and the fleet register
// holds exactly one asset for each — LB-07 registered ZA-2608, LB-21 registered
// ZB-1980. Row 115 is "ZB-4606 / LB-25" and should likewise be one machine.
//
// 1. TM-16 -> DC-07, 93 L. A truck mixer is carrying a double cab's fuel; the
//    plates differ by one character (ZA-8033 against 51-8083). The 12/08 sheet
//    lists them on separate lines, row 18 "2A-8033 | 30" and row 25
//    "51-8083 | 53", and the 27/08 sheet row 16 reads "51-8083 | 10". The report
//    keeps them apart: 150 L on ZA-8033, 93 L on 51-8083.
//    THE 13 AUGUST 30 L IS THE WEAK ONE. That day's sheet shows two rows that
//    both read as ZA-8033 and no 51-8083 line at all, so the paper does not
//    settle it; it is included here only because the report's 93 L total
//    requires it. If the site later says otherwise, that row moves back.
//
// 2. PC-1094 -> PC-1203, 52 L. The 10/08 sheet row 21 reads
//    "PC-1203 | 52(struck) | 641436" with a circled (52). No PC-1203 exists in
//    the fleet, so the importer attached it to PC-1094 — whose odometer then
//    jumps from 293,453 km on 7 August to 641,436 on the 10th, 348,000 km in
//    three days. The asset is created here rather than the row deleted, because
//    the fuel is real and the vehicle exists. It goes into "Other Asset", the
//    fleet's neutral category — nothing on the sheet says what the vehicle is,
//    and PC-1094, 41-7225 and 41-4225 all sit there too. Category cannot be left
//    empty (Asset.categoryId is NOT NULL) and inventing "Double Cab" or "Crew
//    Cab" from the plate prefix would be a guess presented as a fact. No
//    RentalRate row is created, so it bills nothing until someone sets one.
//
// 3. ZB-4606 -> LB-25, 780 L. One backhoe, split when the importer read the
//    plate instead of the code. LB-25's fills stop on 23 July and ZB-4606's
//    start on the 26th — contiguous, never overlapping. The meters settle it:
//    LB-25 last reads 1260 HOURS on 10 August while ZB-4606 runs 1226 on 5
//    August to 1342 on the 31st, the same instrument in the same range climbing
//    4-6 a day, which is a backhoe's engine hours and not kilometres.
//    ZB-4606's readings are therefore relabelled HOURS as they move. LB-25 also
//    has its own code sitting in its registration field, which is what let the
//    second record be created; it becomes ZB-4606.
//
// 4. GE-M47 -> GE-147, 172 L. The report row 147 reads
//    "RE OFFICE USED / GE-147". GE-M47 is a stub created 7 August by an import
//    whose own note says the plate "was unclear in the photograph", holding one
//    fill in its entire lifetime. No bill line anywhere references either
//    generator, so nothing already charged is disturbed.
//    THIS ONE RESTS ON THE REPORT ALONE. GE-147 has drawn no fuel since 25 May
//    and is posted to Badalgama open-ended from 7 April; there is no gate pass,
//    no serial and no photograph tying the Galagedara fill to it. The report
//    names it, and the report is being followed. If a plate ever turns up
//    saying otherwise, this is the change to reverse.

const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const fs = require("node:fs");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.DB || "D:/Fuel system server side/fuelsystem/data/app.db";
if (!fs.existsSync(DB_PATH)) {
  console.error(`\nno database at ${DB_PATH}\n  cwd is ${process.cwd()}\n`);
  process.exit(2);
}

const SOURCE = "Monthly Fuel Consumption Report (Aug 2026), identities reconciled 2026-09-03";

const MERGES = [
  {
    from: "TM-16", to: "DC-07", kind: "rows",
    rows: [["2026-08-12", 53], ["2026-08-13", 30], ["2026-08-27", 10]],
    why: 'the 12/08 sheet lists row 18 "2A-8033 | 30" and row 25 "51-8083 | 53" separately, and the 27/08 sheet row 16 reads "51-8083 | 10"; the report gives ZA-8033 150 L and 51-8083 93 L',
    caveat: "the 13 Aug 30 L is not settled by any sheet — that day shows two ZA-8033 rows and no 51-8083 line",
  },
  {
    from: "PC-1094", to: "PC-1203", kind: "rows", create: { meterType: "KM", categoryName: "Other Asset", typeLabel: "From the 10/08 daily sheet — vehicle type unknown, category left neutral" },
    rows: [["2026-08-10", 52]],
    why: 'the 10/08 sheet row 21 reads "PC-1203 | 52(struck) | 641436 | (52)"; PC-1094\'s odometer otherwise jumps 348,000 km in three days',
  },
  {
    from: "ZB-4606", to: "LB-25", kind: "whole", retype: { from: "KM", to: "HOURS" }, setReg: "ZB-4606",
    why: "report row 115 is \"ZB-4606 / LB-25\", the same registration/code convention as rows 114 and 117 which are each one asset; LB-25's fills stop 23 Jul and ZB-4606's start 26 Jul; LB-25 reads 1260 HOURS on 10 Aug against ZB-4606's 1226-1342 over the same month, one instrument climbing 4-6 a day",
  },
  {
    from: "GE-M47", to: "GE-147", kind: "whole",
    why: 'report row 147 reads "RE OFFICE USED / GE-147"; GE-M47 is a 7 Aug import stub holding one fill, from a run whose note says the plate was unclear in the photograph',
    caveat: "rests on the report alone — no gate pass, serial or photograph ties this fill to GE-147, which has drawn no fuel since 25 May",
  },
];

const db = new Database(DB_PATH);
const day = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const dayBefore = (iso) => new Date(new Date(iso).getTime() - 86400000).toISOString().replace("Z", "+00:00");
const asset = (code) => db.prepare("SELECT * FROM Asset WHERE code=?").get(code);

console.log(`\n=== Galagedara identity merges (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
console.log(`    database: ${DB_PATH}\n`);

const admin = db.prepare("SELECT id FROM User WHERE role='ADMIN' ORDER BY createdAt LIMIT 1").get();

// Where a machine's fuel is billed, per row — the thing these merges actually move.
const billingFor = (codes) => db.prepare(`
  SELECT a.code machine, date(f.issueDate,'+5 hours','+30 minutes') d, f.litres,
         COALESCE(tp.code,'-') tank, COALESCE(bp.code,'UNASSIGNED') bills
  FROM FuelIssue f JOIN Asset a ON a.id=f.assetId
  LEFT JOIN BulkTank t ON t.id=f.bulkTankId LEFT JOIN Project tp ON tp.id=t.projectId
  LEFT JOIN AssetAssignment g ON g.assetId=f.assetId AND g.startDate<=f.issueDate
       AND (g.endDate IS NULL OR g.endDate>=f.issueDate)
  LEFT JOIN Project bp ON bp.id=g.projectId
  WHERE a.code IN (${codes.map(() => "?").join(",")}) AND f.voided=0
    AND f.issueDate >= '2026-07-31T18:30:00.000+00:00' AND f.issueDate < '2026-08-31T18:30:00.000+00:00'
  ORDER BY f.issueDate`).all(...codes);

const plan = [];
const skipped = [];

for (const m of MERGES) {
  const src = asset(m.from);
  if (!src) { skipped.push([`${m.from} -> ${m.to}`, `${m.from} does not exist`]); continue; }
  let dst = asset(m.to);
  if (!dst && !m.create) { skipped.push([`${m.from} -> ${m.to}`, `${m.to} does not exist and no creation rule`]); continue; }

  let fuel;
  if (m.kind === "rows") {
    fuel = [];
    for (const [ymd, litres] of m.rows) {
      const hit = db.prepare(`
        SELECT f.* FROM FuelIssue f WHERE f.assetId=? AND f.voided=0 AND f.litres=?
          AND date(f.issueDate,'+5 hours','+30 minutes')=?`).all(src.id, litres, ymd);
      if (hit.length !== 1) { skipped.push([`${m.from} ${ymd} ${litres}L`, `expected one live row, found ${hit.length}`]); continue; }
      fuel.push(hit[0]);
    }
  } else {
    fuel = db.prepare("SELECT * FROM FuelIssue WHERE assetId=? AND voided=0").all(src.id);
  }
  if (!fuel.length) { skipped.push([`${m.from} -> ${m.to}`, "no rows matched"]); continue; }

  // Build the id list FIRST and derive the placeholders from it. Deriving them
  // from fuel.length instead is wrong the moment a moved row has no meter
  // reading attached, which is most of them.
  let meters;
  if (m.kind === "whole") {
    meters = db.prepare("SELECT * FROM MeterReading WHERE assetId=?").all(src.id);
  } else {
    const ids = fuel.map((f) => f.meterReadingRecordId).filter(Boolean);
    meters = ids.length
      ? db.prepare(`SELECT * FROM MeterReading WHERE assetId=? AND id IN (${ids.map(() => "?").join(",")})`).all(src.id, ...ids)
      : [];
  }

  plan.push({ m, src, dst, fuel, meters });
}

// ------------------------------------------------------------------ report
const touched = [...new Set(plan.flatMap((p) => [p.m.from, p.m.to]))].filter((c) => asset(c));
console.log("  before — August fuel and where each row bills:");
for (const r of billingFor(touched)) {
  const wrong = r.tank !== "-" && r.bills !== "UNASSIGNED" && r.tank !== r.bills;
  console.log(`    ${r.d}  ${r.machine.padEnd(9)}${String(r.litres).padStart(5)} L  tank ${r.tank.padEnd(9)} bills ${r.bills.padEnd(11)}${wrong ? "<-- wrong site" : ""}`);
}

console.log("\n  plan:");
for (const p of plan) {
  const L = p.fuel.reduce((s, f) => s + f.litres, 0);
  console.log(`\n    ${p.m.from} -> ${p.m.to}   ${p.fuel.length} row(s), ${Math.round(L * 100) / 100} L, ${p.meters.length} meter reading(s)`);
  console.log(`      ${p.m.why}`);
  if (p.m.caveat) console.log(`      CAVEAT: ${p.m.caveat}`);
  if (!p.dst) console.log(`      creates asset ${p.m.to} (${p.m.create.meterType}, category "${p.m.create.categoryName}")`);
  if (p.m.retype) console.log(`      relabels ${p.m.retype.from} readings as ${p.m.retype.to}`);
  if (p.m.setReg) console.log(`      sets ${p.m.to} registration to ${p.m.setReg}`);
  for (const f of p.fuel.slice(0, 6)) console.log(`        ${day(f.issueDate)}  ${String(f.litres).padStart(5)} L  meter ${f.meterReading ?? "-"}`);
  if (p.fuel.length > 6) console.log(`        ... and ${p.fuel.length - 6} more`);
}
if (skipped.length) {
  console.log("\n  SKIPPED:");
  for (const [w, why] of skipped) console.log(`    ${w.padEnd(26)}${why}`);
}

if (!APPLY) {
  console.log("\nDRY-RUN — nothing written. Re-run with --apply\n");
  db.close();
  process.exit(0);
}

// ------------------------------------------------------------------- apply
const now = new Date().toISOString().replace("Z", "+00:00");
const audit = (entity, id, summary) => db.prepare(
  `INSERT INTO AuditLog (id,actorId,action,entity,entityId,summary,createdAt) VALUES (?,?,?,?,?,?,?)`)
  .run(randomUUID(), admin.id, "UPDATE", entity, id, summary, now);

db.transaction(() => {
  for (const p of plan) {
    let dstId = p.dst ? p.dst.id : null;

    if (!dstId) {
      dstId = randomUUID();
      const cat = db.prepare("SELECT id FROM Category WHERE name=?").get(p.m.create.categoryName);
      if (!cat) throw new Error(`no category named "${p.m.create.categoryName}"`);
      db.prepare(`INSERT INTO Asset (id,code,regNo,typeLabel,meterType,status,ownership,categoryId,createdAt,updatedAt)
                  VALUES (?,?,?,?,?, 'ACTIVE','OWNED',?,?,?)`)
        .run(dstId, p.m.to, p.m.to, p.m.create.typeLabel, p.m.create.meterType, cat.id, now, now);
      audit("Asset", dstId, `Created ${p.m.to}. ${p.m.why}. Placed in the neutral "Other Asset" category, where PC-1094 also sits: nothing on the sheet says what this vehicle is, and inventing a type from the plate prefix would be a guess presented as fact. No RentalRate row created, so it bills nothing until someone sets one. Source: ${SOURCE}.`);
    }

    for (const f of p.fuel) {
      db.prepare("UPDATE FuelIssue SET assetId=? WHERE id=?").run(dstId, f.id);
      audit("FuelIssue", f.id, `Moved ${f.litres} L on ${day(f.issueDate)} from ${p.m.from} to ${p.m.to}. ${p.m.why}.` +
        (p.m.caveat ? ` CAVEAT: ${p.m.caveat}.` : "") + ` No tank was touched. Source: ${SOURCE}.`);
    }

    for (const mr of p.meters) {
      if (p.m.retype && mr.readingType === p.m.retype.from) {
        db.prepare("UPDATE MeterReading SET assetId=?, readingType=? WHERE id=?").run(dstId, p.m.retype.to, mr.id);
        audit("MeterReading", mr.id, `Moved reading ${mr.value} of ${day(mr.readingDate)} from ${p.m.from} to ${p.m.to} and relabelled ${p.m.retype.from} as ${p.m.retype.to}. ${p.m.why}. Source: ${SOURCE}.`);
      } else {
        db.prepare("UPDATE MeterReading SET assetId=? WHERE id=?").run(dstId, mr.id);
        audit("MeterReading", mr.id, `Moved reading ${mr.value} ${mr.readingType} of ${day(mr.readingDate)} from ${p.m.from} to ${p.m.to}. ${p.m.why}. Source: ${SOURCE}.`);
      }
    }
    if (p.m.retype) {
      db.prepare("UPDATE FuelIssue SET readingType=? WHERE assetId=? AND readingType=?").run(p.m.retype.to, dstId, p.m.retype.from);
    }

    if (p.m.setReg) {
      db.prepare("UPDATE Asset SET regNo=?, updatedAt=? WHERE id=?").run(p.m.setReg, now, dstId);
      audit("Asset", dstId, `Registration set to ${p.m.setReg}; it previously held the machine's own code, which is what let a second record be created from the plate. ${p.m.why}. Source: ${SOURCE}.`);
    }

    // The posting has to follow the fuel, or the receiving site is billed for
    // nothing and the losing site keeps a charge it did not incur.
    for (const f of p.fuel) {
      const tank = db.prepare(`SELECT p.id, p.code FROM BulkTank t JOIN Project p ON p.id=t.projectId WHERE t.id=?`).get(f.bulkTankId);
      if (!tank) continue;
      const covered = db.prepare(`SELECT g.id FROM AssetAssignment g WHERE g.assetId=? AND g.projectId=?
        AND g.startDate<=? AND (g.endDate IS NULL OR g.endDate>=?)`).get(dstId, tank.id, f.issueDate, f.issueDate);
      if (covered) continue;
      const clash = db.prepare(`SELECT g.id, g.startDate, p.code FROM AssetAssignment g JOIN Project p ON p.id=g.projectId
        WHERE g.assetId=? AND g.startDate<=? AND (g.endDate IS NULL OR g.endDate>=?)`).get(dstId, f.issueDate, f.issueDate);
      if (clash) {
        db.prepare("UPDATE AssetAssignment SET endDate=?, updatedAt=? WHERE id=?").run(dayBefore(f.issueDate), now, clash.id);
        audit("AssetAssignment", clash.id, `Closed ${p.m.to}'s ${clash.code} posting at ${day(dayBefore(f.issueDate))}: from ${day(f.issueDate)} the machine was drawing from the ${tank.code} tank, and an open posting elsewhere would bill that fuel to the wrong site. ${p.m.why}. Source: ${SOURCE}.`);
      }
      const gid = randomUUID();
      db.prepare(`INSERT INTO AssetAssignment (id,assetId,projectId,startDate,endDate,note,billingType,createdAt,updatedAt,createdById,origin)
                  VALUES (?,?,?,?,NULL,?,?,?,?,?,?)`).run(
        gid, dstId, tank.id, f.issueDate,
        `Opened when ${p.m.from} was merged into ${p.m.to}; the fuel moved with it and the posting has to follow or the site is billed for fuel it did not burn.`,
        "STANDARD", now, now, admin.id, "FUEL");
      audit("AssetAssignment", gid, `Opened ${tank.code} posting for ${p.m.to} from ${day(f.issueDate)}, following the fuel moved from ${p.m.from}. ${p.m.why}. Source: ${SOURCE}.`);
    }

    if (p.m.kind === "whole") {
      db.prepare("UPDATE Asset SET status='DISPOSED', typeLabel=?, updatedAt=? WHERE id=?")
        .run(`MERGED into ${p.m.to} on 2026-09-03 — a duplicate record, not a machine`, now, p.src.id);
      audit("Asset", p.src.id, `Marked DISPOSED and merged into ${p.m.to}. Kept rather than deleted so the merge stays traceable. ${p.m.why}. Source: ${SOURCE}.`);
    }
  }
})();

db.pragma("wal_checkpoint(TRUNCATE)");

console.log("\n  after — August fuel and where each row bills:");
for (const r of billingFor(touched)) {
  const wrong = r.tank !== "-" && r.bills !== "UNASSIGNED" && r.tank !== r.bills;
  console.log(`    ${r.d}  ${r.machine.padEnd(9)}${String(r.litres).padStart(5)} L  tank ${r.tank.padEnd(9)} bills ${r.bills.padEnd(11)}${wrong ? "<-- STILL WRONG" : ""}`);
}
console.log("\n  Tank totals are unchanged throughout — no litre entered or left a tank.");
console.log("  Regenerate August drafts for every site named above.\n");
db.close();
