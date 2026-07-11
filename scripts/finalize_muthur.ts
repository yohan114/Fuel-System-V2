import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// Finalise Muthur's June fleet before locking:
//  • WG-63 (welding generator) — assign the standard portable welding-gen rate
//    (Rs 3,500/day dry, Rs 7,000/day wet), default DRY, and bill it. Fix its type.
//  • Move DT-76, DT-45, WB-02 off Muthur → Lot-04 (IRD-04): they drew 100% of
//    their June fuel at the Lot 04 pump and have no Muthur fuel.
//  • GE-121 unchanged (2,460 L stays dry / not charged, per instruction).
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const JUN1 = new Date("2026-05-31T18:30:00.000Z");
const JUN30_END = new Date("2026-06-30T18:29:59.999Z");
const MOVE = ["DT-76", "DT-45", "WB-02"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const MUT = await prisma.project.findUnique({ where: { code: "MUTUR" } });
  const IRD = await prisma.project.findUnique({ where: { code: "IRD-04" } });
  if (!MUT || !IRD) throw new Error("project missing");
  console.log(`Finalise Muthur — ${APPLY ? "APPLY" : "dry-run"}\n`);

  const affected: string[] = [];

  // --- WG-63 rate card (dry welding generator) ---
  const wg = await prisma.asset.findFirst({ where: { code: "WG-63" }, include: { rentalRate: true } });
  if (!wg) throw new Error("WG-63 not found");
  console.log(`WG-63: hasRate=${!!wg.rentalRate}, type="${wg.typeLabel}"`);
  if (APPLY) {
    if (!wg.rentalRate) {
      await prisma.rentalRate.create({
        data: {
          assetId: wg.id,
          equipType: "PORTABLE",
          category: "Generator",
          sourceLabel: "Welding generator standard rate",
          portDdCents: 350000, // Rs 3,500/day dry
          portDwCents: 700000, // Rs 7,000/day wet
          defaultBasis: "d",   // bill DRY
        },
      });
    } else {
      await prisma.rentalRate.update({ where: { assetId: wg.id }, data: { equipType: "PORTABLE", portDdCents: 350000, portDwCents: 700000, defaultBasis: "d" } });
    }
    if (wg.typeLabel?.startsWith("From site fuel")) await prisma.asset.update({ where: { id: wg.id }, data: { typeLabel: "Welding Generator" } });
    affected.push(wg.id);
  }

  // --- Move DT-76, DT-45, WB-02 → IRD-04 ---
  for (const code of MOVE) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) throw new Error("not found: " + code);
    console.log(`MOVE ${code} → IRD-04`);
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: IRD.id, startDate: JUN1, endDate: JUN30_END } });
      affected.push(a.id);
    }
  }

  if (!APPLY) { console.log("\nDry-run only. Pass --apply."); await prisma.$disconnect(); return; }

  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: affected, regenerate: true, actorId: null });
  console.log(`\nRegenerated: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("  ERROR", e.assetCode, e.message);

  // Show results
  for (const code of ["WG-63", ...MOVE]) {
    const b = await prisma.bill.findFirst({ where: { assetCode: code, year: Y, month: M } });
    console.log(`  ${code.padEnd(8)} @${b?.projectCode}/${b?.status}  ${b?.billingMode}/${b?.rateBasis}  rental ${rs(b?.rentalAmountCents ?? 0)}  fuel ${b?.fuelLitres}L  grand ${rs(b?.grandTotalCents ?? 0)}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
