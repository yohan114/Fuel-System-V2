import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build Gampaha (GAMP) June 2026 dry bills for HEX-46 and PV-6889 (asset SC-05),
// from the Gampaha Bridge running summary. Both are free in June (no assignment
// or bill elsewhere). Place them on GAMP for June, dry — rental only, no fuel.
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
const CODES = ["HEX-46", "SC-05"]; // SC-05 == reg PV-6889
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const GAMP = await prisma.project.findUnique({ where: { code: "GAMP" } });
  if (!GAMP) throw new Error("no GAMP project");
  console.log(`Gampaha June dry build (${APPLY ? "APPLY" : "dry-run"})`);

  const ids: string[] = [];
  for (const code of CODES) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) { console.log(`  ${code}: NOT FOUND`); continue; }
    // safety: no other June assignment/bill
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: Y, month: M } } });
    if (jb) { console.log(`  ${code}: already has June bill @${jb.projectCode} — SKIP`); continue; }
    console.log(`  ${code}: place on GAMP (dry)`);
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, projectId: GAMP.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: GAMP.id, startDate: JUN1, endDate: JUN30, billingType: "DRY" } });
      ids.push(a.id);
    }
  }
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ids, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);

  const bills = await prisma.bill.findMany({ where: { projectCode: "GAMP", year: Y, month: M }, include: { lineItems: true }, orderBy: { grandTotalCents: "desc" } });
  let grand = 0;
  console.log(`\n=== GAMPAHA JUNE (dry) — ${bills.length} bills ===`);
  for (const b of bills) { grand += b.grandTotalCents; const fuel = b.lineItems.filter((li) => li.kind === "FUEL").reduce((s, li) => s + li.amountCents, 0); console.log(`  ${b.assetCode.padEnd(8)} ${(b.billingMode || "").padEnd(7)} billable=${b.billableUnits} rental ${rs(b.rentalAmountCents).padStart(13)}  fuel ${rs(fuel)}  grand ${rs(b.grandTotalCents).padStart(13)}`); }
  console.log(`\n  GAMPAHA JUNE TOTAL: ${rs(grand)} (DRAFT)`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
