import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build Ruwanwella (RUWA) June 2026 dry bills from the March RUWA roster.
// Take every vehicle billed at RUWA in March, exclude any that is already
// invoiced or assigned to another project in June (one invoice per vehicle per
// month), place the rest on RUWA for June (dry) and bill them dry — rental
// only, no fuel. Idle standby vehicles bill their guaranteed minimum.
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const RUWA = await prisma.project.findUnique({ where: { code: "RUWA" } });
  if (!RUWA) throw new Error("no RUWA project");

  const marBills = await prisma.bill.findMany({ where: { projectCode: "RUWA", year: 2026, month: 3 }, select: { assetId: true, assetCode: true } });
  console.log(`March RUWA roster: ${marBills.length} vehicles (${APPLY ? "APPLY" : "dry-run"})`);

  const include: { id: string; code: string }[] = [];
  const skip: string[] = [];
  for (const mb of marBills) {
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: mb.assetId, year: Y, month: M } } });
    const jAsg = await prisma.assetAssignment.findMany({ where: { assetId: mb.assetId, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] }, include: { project: true } });
    const other = jAsg.filter((a) => a.projectId !== RUWA.id);
    if (jb) { skip.push(`${mb.assetCode} — June invoice ${jb.invoiceNumber || jb.status} @${jb.projectCode}`); continue; }
    if (other.length) { skip.push(`${mb.assetCode} — June assigned @${[...new Set(other.map((a) => a.project.code))].join(",")}`); continue; }
    include.push({ id: mb.assetId, code: mb.assetCode });
  }
  console.log(`\nExcluded — in another project in June (${skip.length}):`);
  for (const s of skip) console.log("   -", s);
  console.log(`\nBill at RUWA June dry (${include.length}): ${include.map((v) => v.code).join(", ")}`);

  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const ids: string[] = [];
  for (const v of include) {
    await prisma.assetAssignment.deleteMany({ where: { assetId: v.id, projectId: RUWA.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
    await prisma.assetAssignment.create({ data: { assetId: v.id, projectId: RUWA.id, startDate: JUN1, endDate: JUN30, billingType: "DRY" } });
    ids.push(v.id);
  }
  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ids, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);

  const bills = await prisma.bill.findMany({ where: { projectCode: "RUWA", year: Y, month: M }, include: { lineItems: true }, orderBy: { grandTotalCents: "desc" } });
  let grand = 0, fuel = 0;
  console.log(`\n=== RUWA JUNE (dry) — ${bills.length} bills ===`);
  for (const b of bills) { grand += b.grandTotalCents; fuel += b.lineItems.filter((li) => li.kind === "FUEL").reduce((s, li) => s + li.amountCents, 0); console.log(`  ${b.assetCode.padEnd(9)} ${(b.billingMode || "").padEnd(7)} rental ${rs(b.rentalAmountCents).padStart(13)}  grand ${rs(b.grandTotalCents).padStart(13)}`); }
  console.log(`\n  Fuel charged: ${rs(fuel)} ${fuel === 0 ? "(all dry)" : ""}`);
  console.log(`  RUWA JUNE TOTAL: ${rs(grand)} across ${bills.length} DRAFT invoices.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
