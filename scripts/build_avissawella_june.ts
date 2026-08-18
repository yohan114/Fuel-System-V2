import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build Avissawella (AWIS) June 2026 dry bills. Take the distinct AWIS roster
// (vehicles assigned to AWIS across Feb–May), exclude any already invoiced or
// assigned to another project in June, place the rest on AWIS for June (dry),
// and bill them dry — rental only, no fuel. Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
// roster window Feb–May
const RS = new Date("2026-01-31T18:30:00.000Z");
const RE = new Date("2026-05-31T18:29:59.999Z");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const AWIS = await prisma.project.findUnique({ where: { code: "AWIS" } });
  if (!AWIS) throw new Error("no AWIS project");

  const roster = await prisma.assetAssignment.findMany({ where: { projectId: AWIS.id, startDate: { lte: RE }, OR: [{ endDate: null }, { endDate: { gte: RS } }] }, include: { asset: true } });
  const seen = new Set<string>();
  const distinct = roster.filter((a) => (seen.has(a.assetId) ? false : (seen.add(a.assetId), true)));
  console.log(`AWIS roster (Feb–May): ${distinct.length} vehicles (${APPLY ? "APPLY" : "dry-run"})`);

  const include: { id: string; code: string }[] = [];
  const skip: string[] = [];
  for (const r of distinct) {
    const jb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: r.assetId, year: Y, month: M } } });
    const jAsg = await prisma.assetAssignment.findMany({ where: { assetId: r.assetId, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] }, include: { project: true } });
    const other = jAsg.filter((a) => a.projectId !== AWIS.id);
    if (jb) { skip.push(`${r.asset.code} — June invoice ${jb.invoiceNumber || jb.status} @${jb.projectCode}`); continue; }
    if (other.length) { skip.push(`${r.asset.code} — June assigned @${[...new Set(other.map((a) => a.project.code))].join(",")}`); continue; }
    include.push({ id: r.assetId, code: r.asset.code });
  }
  console.log(`\nExcluded — in another project in June (${skip.length}):`);
  for (const s of skip) console.log("   -", s);
  console.log(`\nBill at AWIS June dry (${include.length}): ${include.map((v) => v.code).join(", ")}`);

  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const ids: string[] = [];
  for (const v of include) {
    await prisma.assetAssignment.deleteMany({ where: { assetId: v.id, projectId: AWIS.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
    await prisma.assetAssignment.create({ data: { assetId: v.id, projectId: AWIS.id, startDate: JUN1, endDate: JUN30, billingType: "DRY" } });
    ids.push(v.id);
  }
  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ids, regenerate: true, actorId: null, basis: "d" });
  console.log(`\ngenerate: created ${res.created}, regen ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERR", e.assetCode, e.message);

  const bills = await prisma.bill.findMany({ where: { projectCode: "AWIS", year: Y, month: M }, include: { lineItems: true }, orderBy: { grandTotalCents: "desc" } });
  let grand = 0, fuel = 0;
  console.log(`\n=== AWIS JUNE (dry) — ${bills.length} bills ===`);
  for (const b of bills) { grand += b.grandTotalCents; fuel += b.lineItems.filter((li) => li.kind === "FUEL").reduce((s, li) => s + li.amountCents, 0); console.log(`  ${b.assetCode.padEnd(11)} ${(b.billingMode || "").padEnd(7)} units=${b.billableUnits} rental ${rs(b.rentalAmountCents).padStart(13)}  grand ${rs(b.grandTotalCents).padStart(13)}`); }
  console.log(`\n  Fuel charged: ${rs(fuel)} ${fuel === 0 ? "(all dry)" : ""}`);
  console.log(`  AWIS JUNE TOTAL: ${rs(grand)} across ${bills.length} DRAFT invoices.`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
