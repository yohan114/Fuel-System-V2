import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Build out Lot-04 (IRD-04) for June 2026 from the fuel evidence (no site sheet
// supplied): every vehicle that drew ~100% of its June fuel at the Lot 04 pump is
// given a single IRD-04 June assignment and (re)generated, which:
//   • moves the 7 vehicles currently drafted at CEP-03W into Lot-04,
//   • generates the 8 that had no bill,
//   • homes the 2 that had a null-site bill (DT-61, DT-13),
//   • fixes the 3 fuel-only bills that read Rs 0 (no assignment → legacy path
//     dropped their Lot-04-sourced fuel; the segmented path charges it),
//   • sets RG-3189 to fuel-only (Other Asset, no rate card) so its 175 L bills.
// The 3 already-issued IRD-04 invoices (LB-10, LB-14, BM-02) are left untouched.
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30 = new Date("2026-06-30T18:29:59.999Z");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

const KEEP_ISSUED = ["LB-10", "LB-14", "BM-02"]; // already locked at IRD-04
const FUEL_ONLY = ["RG-3189"]; // Other Asset, no rate → bill fuel only
const FLEET = [
  "MG-11", "HCC-05", "DAI-4487", "SR-17", "LB-17", "DT-76", "HEX-05", "DAA-7422", "DT-61",
  "HCC-04", "WB-02", "DT-81", "DT-83", "DT-13", "VR-70", "RG-3189", "GD-405", "SL-03", "DT-43",
  "SL-17", "DT-45", "BM-05", "GE-37", "HEX-35", "VR-54", "SL-05", "DT-68", "SC-13", "SC-14",
];

async function main() {
  const IRD = await prisma.project.findUnique({ where: { code: "IRD-04" } });
  if (!IRD) throw new Error("IRD-04 missing");
  console.log(`Build Lot-04 (IRD-04) — ${FLEET.length} vehicles, ${APPLY ? "APPLY" : "dry-run"}\n`);

  const assetIds: string[] = [];
  for (const code of FLEET) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) { console.log(`  ${code}: NOT FOUND`); continue; }
    const cur = await prisma.assetAssignment.findMany({
      where: { assetId: a.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] },
      include: { project: true },
    });
    const hasIRD = cur.some((x) => x.project.code === "IRD-04");
    const others = cur.filter((x) => x.project.code !== "IRD-04").map((x) => x.project.code);
    console.log(`  ${code.padEnd(9)} ${FUEL_ONLY.includes(code) ? "[fuel-only] " : ""}${hasIRD ? "at IRD-04" : others.length ? "move from " + others.join(",") : "no June assignment"}`);
    if (APPLY) {
      if (FUEL_ONLY.includes(code)) await prisma.asset.update({ where: { id: a.id }, data: { billFuelOnly: true } });
      const dom = [...cur].sort((x, y) => (y.endDate!.getTime() - y.startDate.getTime()) - (x.endDate!.getTime() - x.startDate.getTime()))[0];
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, projectId: { not: IRD.id }, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      if (!hasIRD) await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: IRD.id, startDate: JUN1, endDate: JUN30, billingType: dom?.billingType ?? null, driverName: dom?.driverName ?? null } });
      assetIds.push(a.id);
    }
  }

  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds, regenerate: true, actorId: null });
  console.log(`\nRegenerated: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, skipped ${res.skippedExisting + res.skippedFinalized}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERROR", e.assetCode, e.message);

  const bills = await prisma.bill.findMany({ where: { projectCode: "IRD-04", year: Y, month: M }, orderBy: { grandTotalCents: "desc" } });
  let sum = 0;
  console.log(`\n=== Lot-04 (IRD-04) — ${bills.length} bills ===`);
  for (const b of bills) { sum += b.grandTotalCents; console.log(`  ${b.assetCode.padEnd(9)} ${b.status.padEnd(7)} ${rs(b.grandTotalCents).padStart(13)}  fuel ${b.fuelLitres}L  rental ${rs(b.rentalAmountCents)}`); }
  console.log(`\nLot-04 total: ${rs(sum)} (${bills.length} vehicles)`);
  const noRate = res.assets.filter((a) => a.status === "no-rate");
  if (noRate.length) console.log("No-rate (need a rate or fuel-only):", noRate.map((a) => a.assetCode).join(", "));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
