import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build Batti ICDP Lot-03 (BATTI-03) June 2026 dry bills for the 8 vehicles from
// the Lot-03 running summary that are free in June (the other 7 are already
// finalized at other sites). Place them on BATTI-03 for June, dry — rental only.
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
// System codes (some differ from the sheet's reg no): LP-1711=DT-84, LK-4056=DT-14,
// LO-4822=DT-42, ZB-2583=LB-24.
const CODES = ["DT-84", "DT-14", "DT-42", "MG-15", "VR-66", "VR-68", "LB-24", "SL-04"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const P = await prisma.project.findUnique({ where: { code: "BATTI-03" } });
  if (!P) throw new Error("no BATTI-03 project");
  console.log(`Batti Lot-03 June dry build (${APPLY ? "APPLY" : "dry-run"})`);
  const ids: string[] = [];
  for (const code of CODES) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) { console.log(`  ${code}: NOT FOUND`); continue; }
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: Y, month: M } } });
    if (jb) { console.log(`  ${code}: already has June bill @${jb.projectCode} — SKIP`); continue; }
    console.log(`  ${code}: place on BATTI-03 (dry)`);
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
  const bills = await prisma.bill.findMany({ where: { projectCode: "BATTI-03", year: Y, month: M }, include: { lineItems: true }, orderBy: { grandTotalCents: "desc" } });
  let grand = 0, fuel = 0;
  console.log(`\n=== BATTI LOT-03 JUNE (dry) — ${bills.length} bills ===`);
  for (const b of bills) { grand += b.grandTotalCents; fuel += b.lineItems.filter((li) => li.kind === "FUEL").reduce((s, li) => s + li.amountCents, 0); console.log(`  ${b.assetCode.padEnd(9)} ${(b.billingMode || "").padEnd(7)} billable=${String(b.billableUnits).padStart(4)} rental ${rs(b.rentalAmountCents).padStart(12)}  grand ${rs(b.grandTotalCents).padStart(13)}`); }
  console.log(`\n  Fuel charged: ${rs(fuel)}   BATTI LOT-03 JUNE TOTAL: ${rs(grand)} (${bills.length} DRAFT)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
