import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Add the rental-only vehicles to Lot-04 (IRD-04) for June: on the Lot-04 sheet,
// present on-site, but drew no E&C fuel in June, so they bill their guaranteed
// minimum on the DRY rate (no fuel line). SR-16 was idle/unassigned; BM-01, BD-06,
// SC-10 move over from CEP-03W (draft). The 4 that fuelled at another locked site
// in June (HCC-10, BD-01, DT-27, PE-3723) and the 3 with no rate card
// (51-8053, RS-3189, RG-3981) are intentionally excluded.
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
const ADD = ["SR-16", "BM-01", "BD-06", "SC-10"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const IRD = await prisma.project.findUnique({ where: { code: "IRD-04" } });
  if (!IRD) throw new Error("IRD-04 missing");
  console.log(`Add Lot-04 rental-only (DRY) — ${ADD.length} vehicles, ${APPLY ? "APPLY" : "dry-run"}\n`);
  const assetIds: string[] = [];
  for (const code of ADD) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) { console.log(`  ${code}: NOT FOUND`); continue; }
    const cur = await prisma.assetAssignment.findMany({ where: { assetId: a.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] }, include: { project: true } });
    console.log(`  ${code.padEnd(7)} from ${cur.map((x) => x.project.code).join(",") || "(unassigned)"} → IRD-04 (dry)`);
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: IRD.id, startDate: JUN1, endDate: JUN30, billingType: "DRY" } });
      assetIds.push(a.id);
    }
  }
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds, regenerate: true, actorId: null });
  console.log(`\nRegenerated: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERROR", e.assetCode, e.message);
  for (const code of ADD) {
    const b = await prisma.bill.findFirst({ where: { assetCode: code, year: Y, month: M } });
    console.log(`  ${code.padEnd(7)} @${b?.projectCode}/${b?.status} ${b?.billingMode}/${b?.rateBasis} rental ${rs(b?.rentalAmountCents ?? 0)} fuel ${b?.fuelLitres}L grand ${rs(b?.grandTotalCents ?? 0)}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
