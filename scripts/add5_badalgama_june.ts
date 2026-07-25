import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Add the 5 remaining Badalgama register vehicles to the June 2026 dry bill:
//   reactivate WB-03, WB-10 (were DISPOSED); create TB-03, TB-08, TM-02 by
//   cloning a sibling's category + rate card. Place each on its sub-site and bill.
const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

// code -> { subsite project code, action, sibling(for create), regNo, type }
const PLAN = [
  { code: "WB-03", proj: "BADAL-WS", action: "reactivate" as const },
  { code: "WB-10", proj: "BDL",      action: "reactivate" as const },
  { code: "TB-03", proj: "BDL",      action: "create" as const, sib: "TB-04", regNo: null,        type: "Tractor Bowser" },
  { code: "TB-08", proj: "BADAL-WS", action: "create" as const, sib: "TB-04", regNo: null,        type: "Tractor Bowser" },
  { code: "TM-02", proj: "BADAL-WS", action: "create" as const, sib: "TM-01", regNo: "LK-5047",   type: "Truck Mixer" },
];

async function cloneRate(assetId: string, sibCode: string, newCode: string) {
  const sib = await prisma.asset.findUnique({ where: { code: sibCode }, include: { rentalRate: true } });
  const r = sib!.rentalRate!;
  await prisma.rentalRate.create({ data: {
    assetId, equipType: r.equipType, category: r.category, sourceLabel: `${newCode} · cloned from ${sibCode}`,
    fuelQtyDefault: r.fuelQtyDefault, opRate: r.opRate,
    hrFwCents: r.hrFwCents, hrWCents: r.hrWCents, hrDCents: r.hrDCents,
    dyFwCents: r.dyFwCents, dyWCents: r.dyWCents, dyDCents: r.dyDCents,
    kmFwCents: r.kmFwCents, kmWCents: r.kmWCents, kmDCents: r.kmDCents,
    portDwCents: r.portDwCents, portDdCents: r.portDdCents, defaultBasis: r.defaultBasis,
    fuelConsEcon: r.fuelConsEcon, fuelConsTyp: r.fuelConsTyp, fuelConsHeavy: r.fuelConsHeavy, fuelConsBasis: r.fuelConsBasis,
  }});
}

async function main() {
  const projByCode: Record<string, string> = {};
  for (const c of ["BDL", "BADAL-WS"]) {
    const p = await prisma.project.findUnique({ where: { code: c } });
    if (!p) throw new Error(`project ${c} missing`); projByCode[c] = p.id;
  }
  const ids: string[] = [];
  for (const item of PLAN) {
    let a = await prisma.asset.findUnique({ where: { code: item.code }, include: { rentalRate: true } });
    if (item.action === "reactivate") {
      if (!a) { console.log(`${item.code}: expected existing (disposed) — MISSING, skip`); continue; }
      if (APPLY) a = await prisma.asset.update({ where: { code: item.code }, data: { status: "ACTIVE" }, include: { rentalRate: true } });
      console.log(`${item.code}: reactivated (was disposed) -> ${item.proj}  rate hrD=${a.rentalRate?.hrDCents}`);
    } else {
      const sib = await prisma.asset.findUnique({ where: { code: item.sib! } });
      if (a) { console.log(`${item.code}: already exists — will (re)use`); }
      else if (APPLY) {
        a = await prisma.asset.create({ data: {
          code: item.code, meterType: "HOURS", status: "ACTIVE",
          categoryId: sib!.categoryId, regNo: item.regNo, typeLabel: item.type, site: item.proj === "BDL" ? "Badalgama" : "Badalgama Workshop",
        }, include: { rentalRate: true } });
        await cloneRate(a.id, item.sib!, item.code);
        console.log(`${item.code}: created (cat from ${item.sib}) + rate cloned from ${item.sib} -> ${item.proj}`);
      } else {
        console.log(`[dry] ${item.code}: would create (cat+rate from ${item.sib}) -> ${item.proj}`);
      }
    }
    if (APPLY && a) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, startDate: { gte: JS }, endDate: { not: null, lte: JE } } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: projByCode[item.proj], startDate: JS, endDate: JE, billingType: "DRY" } });
      ids.push(a.id);
    }
  }
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ids, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, noRate ${res.noRate}, skipNotHere ${res.skippedNotHere}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);
  for (const item of PLAN) {
    const a = await prisma.asset.findUnique({ where: { code: item.code } });
    const b = a ? await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: Y, month: M } } }) : null;
    console.log(`  ${item.code.padEnd(7)} -> ${b ? `${b.projectCode} ${b.billingMode} bill=${b.billableUnits} ${rs(b.grandTotalCents)}` : "NO BILL"}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
