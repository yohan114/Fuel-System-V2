import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build Marawila (MARA) June 2026 dry bills for the 19 vehicles from the May
// roster that are free in June (rated). Place them on MARA for June, dry.
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
const CODES = ["PD-7049","GJ-8775","59-1280","HCC-06","DT-66","LP-7183","DT-11","RD-8851","SR-12","SR-09","MG-5","MG-04","VR-10","VR-14","VR-23","VR-64","VR-59","SL-06","LB-25"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const P = await prisma.project.findUnique({ where: { code: "MARA" } });
  if (!P) throw new Error("no MARA project");
  console.log(`Marawila June dry build (${APPLY ? "APPLY" : "dry-run"}) — ${CODES.length} vehicles`);
  const ids: string[] = [];
  for (const code of CODES) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) { console.log(`  ${code}: NOT FOUND`); continue; }
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: Y, month: M } } });
    if (jb) { console.log(`  ${code}: already has June bill @${jb.projectCode} — SKIP`); continue; }
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, projectId: P.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: P.id, startDate: JUN1, endDate: JUN30, billingType: "DRY" } });
      ids.push(a.id);
    }
  }
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ids, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);
  const bills = await prisma.bill.findMany({ where: { projectCode: "MARA", year: Y, month: M }, include: { lineItems: true }, orderBy: { grandTotalCents: "desc" } });
  let grand = 0, fuel = 0;
  console.log(`\n=== MARAWILA JUNE (dry) — ${bills.length} bills ===`);
  for (const b of bills) { grand += b.grandTotalCents; fuel += b.lineItems.filter((li) => li.kind === "FUEL").reduce((s, li) => s + li.amountCents, 0); console.log(`  ${b.assetCode.padEnd(9)} ${(b.billingMode || "").padEnd(7)} bill=${String(b.billableUnits).padStart(4)} rental ${rs(b.rentalAmountCents).padStart(12)}  grand ${rs(b.grandTotalCents).padStart(13)}`); }
  console.log(`\n  Fuel charged: ${rs(fuel)}   MARAWILA JUNE TOTAL: ${rs(grand)} (${bills.length} DRAFT)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
