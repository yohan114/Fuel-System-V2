import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// VPS-SAFE June 2026 rebuild.
//
// Reproduces the June billing state on any machine WITHOUT copying data/app.db,
// so a live server keeps every fuel issue, meter reading and correction its
// operators have entered. Only billing rows and June allocations are touched.
//
//   1. Delete all June 2026 bills EXCEPT Galagedara (CEP-03F) — already correct.
//   2. Ensure the Badalgama yard's 3 sub-site projects exist.
//   3. Reactivate WB-03 / WB-10 and create TB-03 / TB-08 / TM-02 (rates cloned).
//   4. Post every roster vehicle to its sub-site for June (DRY) and bill it.
//
// Re-running is safe: step 1 is deterministic, step 3 reuses existing records,
// and step 4 replaces its own June postings rather than stacking new ones.
// Finalized (ISSUED) bills elsewhere are never overwritten — the generator
// skips them.
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const KEEP = "CEP-03F";                                  // Galagedara — leave alone
const JS = new Date("2026-05-31T18:30:00.000Z");         // 1 Jun 00:00 Colombo
const JE = new Date("2026-06-30T18:29:59.999Z");         // 30 Jun 23:59 Colombo
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Badalgama yard roster, split by the register's original site label.
const ROSTER: { code: string; name: string; vehicles: string[] }[] = [
  { code: "BDL", name: "Badalgama", vehicles: [
    "AP-08","AP-09","BD-01","BD-02","BD-03","BD-04","BD-08","BM-01","BM-02","BM-04","BM-05","CR-02",
    "DC-10","DC-12","FL-01","FL-02","FL-03","HCC-11","LD-05","PTR-02","PTR-04","PTR-07","PTR-08",
    "PTR-09","SR-14","SR-19","TB-03","TB-04","TB-11","VR-02","VR-06","VR-46","VR-47","WB-10" ] },
  { code: "BADAL", name: "Badalgama Plant", vehicles: [
    "BS-04","DT-01","DT-42","DT-44","DT-49","DT-58","DT-65","DT-66","DT-75","DT-82","DT-83",
    "HEX-18","PC-01","PC-02" ] },
  { code: "BADAL-WS", name: "Badalgama Workshop", vehicles: [
    "BS-02","BS-05","DB-01","DB-04","DT-04","DT-07","DT-08","DT-11","DT-15","DT-18","DT-19","DT-22",
    "DT-23","DT-24","DT-25","DT-26","DT-28","DT-29","DT-30","DT-31","DT-33","DT-35","DT-38","DT-41",
    "DT-51","DT-52","DT-54","DT-55","DT-60","FT-03","FT-09","HEX-07","HEX-17","HEX-21","HEX-29",
    "HEX-37","LB-02","LB-15","LD-02","LD-06","MG-03","MG-04","MG-05","MG-06","MG-15","PV-01","SC-06",
    "SL-06","SL-07","SL-08","SL-14","SR-04","SR-05","SR-10","SR-11","SR-15","TB-08","TM-01","TM-02",
    "TM-04","TM-08","TM-10","TM-15","TM-19","VR-03","VR-07","VR-08","VR-09","VR-10","VR-13","VR-22",
    "VR-23","VR-24","VR-25","VR-27","VR-31","VR-37","VR-42","VR-43","VR-44","VR-45","VR-52","VR-65",
    "VR-71","WB-01","WB-03","WB-05","WB-16","WB-19","WB-20" ] },
];

// Vehicles missing or retired on a stock database, and the sibling whose rate
// card they inherit. Registration numbers come from the register.
const ENSURE: { code: string; sibling: string; regNo: string | null; typeLabel: string }[] = [
  { code: "WB-03", sibling: "WB-01", regNo: "HO-9850", typeLabel: "Water Bowser" },
  { code: "WB-10", sibling: "WB-01", regNo: "RY-0301", typeLabel: "Water Bowser" },
  { code: "TB-03", sibling: "TB-04", regNo: null,      typeLabel: "Tractor Bowser" },
  { code: "TB-08", sibling: "TB-04", regNo: null,      typeLabel: "Tractor Bowser" },
  { code: "TM-02", sibling: "TM-01", regNo: "LK-5047", typeLabel: "Truck Mixer" },
];

async function cloneRate(assetId: string, siblingCode: string, newCode: string) {
  const sib = await prisma.asset.findUnique({ where: { code: siblingCode }, include: { rentalRate: true } });
  const r = sib?.rentalRate;
  if (!r) { console.log(`      ! ${siblingCode} has no rate card — ${newCode} left unrated`); return; }
  await prisma.rentalRate.create({ data: {
    assetId, equipType: r.equipType, category: r.category, sourceLabel: `${newCode} · cloned from ${siblingCode}`,
    fuelQtyDefault: r.fuelQtyDefault, opRate: r.opRate,
    hrFwCents: r.hrFwCents, hrWCents: r.hrWCents, hrDCents: r.hrDCents,
    dyFwCents: r.dyFwCents, dyWCents: r.dyWCents, dyDCents: r.dyDCents,
    kmFwCents: r.kmFwCents, kmWCents: r.kmWCents, kmDCents: r.kmDCents,
    portDwCents: r.portDwCents, portDdCents: r.portDdCents, defaultBasis: r.defaultBasis,
    fuelConsEcon: r.fuelConsEcon, fuelConsTyp: r.fuelConsTyp, fuelConsHeavy: r.fuelConsHeavy,
    fuelConsBasis: r.fuelConsBasis,
  }});
}

async function main() {
  console.log(`\n=== June ${Y}-${String(M).padStart(2,"0")} rebuild (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);

  // Operational data must be untouched — record it before and after.
  const before = {
    fuelIssues: await prisma.fuelIssue.count(),
    meterReadings: await prisma.meterReading.count(),
    users: await prisma.user.count(),
  };
  console.log(`Operational rows: fuelIssues=${before.fuelIssues} meterReadings=${before.meterReadings} users=${before.users}`);

  // 1 — clear June, keeping Galagedara
  const doomed = await prisma.bill.findMany({
    where: { year: Y, month: M, projectCode: { not: KEEP } },
    select: { id: true, grandTotalCents: true },
  });
  const kept = await prisma.bill.count({ where: { year: Y, month: M, projectCode: KEEP } });
  console.log(`\n[1] June bills to delete: ${doomed.length} (${rs(doomed.reduce((s,b)=>s+b.grandTotalCents,0))}) · ${KEEP} kept: ${kept}`);
  if (APPLY && doomed.length) {
    const ids = doomed.map(b => b.id);
    await prisma.$transaction(async (tx) => {
      await tx.billLineItem.deleteMany({ where: { billId: { in: ids } } });
      await tx.billRevision.deleteMany({ where: { billId: { in: ids } } });
      await tx.payment.deleteMany({ where: { billId: { in: ids } } });
      await tx.creditNote.deleteMany({ where: { billId: { in: ids } } });
      const d = await tx.bill.deleteMany({ where: { id: { in: ids } } });
      console.log(`    deleted ${d.count} bills`);
    });
  }

  // 2 — sub-site projects
  console.log(`\n[2] Sub-site projects`);
  const projectId: Record<string, string> = {};
  for (const grp of ROSTER) {
    let p = await prisma.project.findUnique({ where: { code: grp.code } });
    if (!p) {
      console.log(`    ${grp.code} (${grp.name}) missing${APPLY ? " — creating" : " — would create"}`);
      if (APPLY) p = await prisma.project.create({ data: { code: grp.code, name: grp.name } });
    } else {
      console.log(`    ${grp.code} (${p.name}) ok`);
    }
    if (p) projectId[grp.code] = p.id;
  }

  // 3 — reactivate / create the special vehicles
  console.log(`\n[3] Roster completeness`);
  for (const item of ENSURE) {
    const a = await prisma.asset.findUnique({ where: { code: item.code }, include: { rentalRate: true } });
    if (a && a.status === "ACTIVE") { console.log(`    ${item.code}: ok`); continue; }
    if (a) {
      console.log(`    ${item.code}: ${a.status}${APPLY ? " — reactivating" : " — would reactivate"}`);
      if (APPLY) await prisma.asset.update({ where: { code: item.code }, data: { status: "ACTIVE" } });
      continue;
    }
    console.log(`    ${item.code}: missing${APPLY ? ` — creating (rate from ${item.sibling})` : ` — would create (rate from ${item.sibling})`}`);
    if (!APPLY) continue;
    const sib = await prisma.asset.findUnique({ where: { code: item.sibling } });
    if (!sib) { console.log(`      ! sibling ${item.sibling} not found — skipped`); continue; }
    const created = await prisma.asset.create({ data: {
      code: item.code, meterType: sib.meterType, status: "ACTIVE",
      categoryId: sib.categoryId, regNo: item.regNo, typeLabel: item.typeLabel,
    }});
    await cloneRate(created.id, item.sibling, item.code);
  }

  // 4 — post to sub-sites for June and bill
  console.log(`\n[4] June allocations + billing`);
  const billIds: string[] = [];
  const absent: string[] = [];
  for (const grp of ROSTER) {
    const pid = projectId[grp.code];
    if (!pid) { console.log(`    ${grp.code}: project unavailable — skipped`); continue; }
    let posted = 0;
    for (const code of grp.vehicles) {
      const a = await prisma.asset.findUnique({ where: { code }, include: { rentalRate: true } });
      if (!a) { absent.push(code); continue; }
      if (!a.rentalRate) { absent.push(`${code}(no rate)`); continue; }
      const existing = await prisma.bill.findUnique({
        where: { assetId_year_month: { assetId: a.id, year: Y, month: M } },
      });
      if (existing && existing.status !== "DRAFT") continue;   // locked elsewhere — leave it
      if (APPLY) {
        // Replace only THIS yard's own June postings, so re-running cannot stack
        // duplicates. Other sites' allocations are deliberately left alone: a
        // vehicle that genuinely moved mid-June (e.g. HCC-11 → Pallam Oya on the
        // 15th) keeps its split, and sites not yet rebuilt keep their history.
        // Badalgama still owns the rest of the month — per day the assignment
        // with the latest start wins, and ties break to the newest record.
        await prisma.assetAssignment.deleteMany({
          where: {
            assetId: a.id,
            projectId: { in: Object.values(projectId) },
            startDate: { gte: JS },
            endDate: { not: null, lte: JE },
          },
        });
        await prisma.assetAssignment.create({
          data: { assetId: a.id, projectId: pid, startDate: JS, endDate: JE, billingType: "DRY" },
        });
        billIds.push(a.id);
      }
      posted++;
    }
    console.log(`    ${grp.code.padEnd(9)} ${String(posted).padStart(3)} vehicles posted`);
  }
  if (absent.length) console.log(`    not on this database: ${absent.join(", ")}`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing changed. Re-run with --apply\n`); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: billIds, regenerate: true, actorId: null, basis: "d" });
  console.log(`    generate: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, locked-skip ${res.skippedFinalized}, not-here ${res.skippedNotHere}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log(`      ERR ${e.assetCode}: ${e.message}`);

  // Summary + operational-data assertion
  console.log(`\n=== RESULT ===`);
  let grand = 0, count = 0;
  for (const grp of ROSTER) {
    const bills = await prisma.bill.findMany({ where: { projectCode: grp.code, year: Y, month: M }, select: { grandTotalCents: true } });
    const sub = bills.reduce((s, b) => s + b.grandTotalCents, 0);
    grand += sub; count += bills.length;
    console.log(`  ${grp.name.padEnd(20)} ${String(bills.length).padStart(3)} bills  ${rs(sub).padStart(16)}`);
  }
  console.log(`  ${"BADALGAMA YARD".padEnd(20)} ${String(count).padStart(3)} bills  ${rs(grand).padStart(16)}`);
  const gal = await prisma.bill.findMany({ where: { projectCode: KEEP, year: Y, month: M }, select: { grandTotalCents: true } });
  console.log(`  ${"Galagedara (kept)".padEnd(20)} ${String(gal.length).padStart(3)} bills  ${rs(gal.reduce((s,b)=>s+b.grandTotalCents,0)).padStart(16)}`);

  const after = {
    fuelIssues: await prisma.fuelIssue.count(),
    meterReadings: await prisma.meterReading.count(),
    users: await prisma.user.count(),
  };
  const intact = after.fuelIssues === before.fuelIssues && after.meterReadings === before.meterReadings && after.users === before.users;
  console.log(`\nOperational data ${intact ? "INTACT ✓" : "CHANGED ✗ — investigate"}  ` +
              `(fuelIssues ${before.fuelIssues}→${after.fuelIssues}, readings ${before.meterReadings}→${after.meterReadings}, users ${before.users}→${after.users})\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
