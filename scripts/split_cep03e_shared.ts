import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

// CEP-03 E Package — apply the user-approved proportional split (option "b") to the
// 10 vehicles that are assigned to BOTH CEP-03 Wadakada (CEP-03W) and CEP-03 E
// Package (CEP-03E) for June 2026. All 10 drew 100% of their June fuel from the E
// pump and have no Wadakada usage signal (running hours empty), so the proportional
// method resolves each to 100% E — the same precedent as LB-10/LB-14 in the locked
// sites. We therefore drop the spurious CEP-03W June assignment (0-day W segment)
// and regenerate, leaving CEP-03E as the sole June segment.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const YEAR = 2026, MONTH = 6;
const CODES = ["GE-117", "GE 105", "HEX-42", "TM-14", "DT-56", "DT-79", "DT-22", "DT-28", "TM-16", "WG-08"];
const JUN_START = new Date("2026-05-31T18:30:00.000Z");
const JUN_END = new Date("2026-06-30T18:29:59.999Z");

const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

async function main() {
  const W = await prisma.project.findUnique({ where: { code: "CEP-03W" } });
  const E = await prisma.project.findUnique({ where: { code: "CEP-03E" } });
  if (!W || !E) throw new Error("CEP-03W/CEP-03E project missing");

  const assets = await prisma.asset.findMany({ where: { code: { in: CODES } }, select: { id: true, code: true } });
  const assetIds = assets.map((a) => a.id);
  console.log(`CEP-03E shared-vehicle split — ${assets.length} vehicles, ${YEAR}-${MONTH} (${APPLY ? "APPLY" : "dry-run"})\n`);

  // BEFORE snapshot
  const before = new Map<string, { code: string; pc: string; rental: number; fuelL: number; fuelC: number; grand: number }>();
  for (const a of assets) {
    const b = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: YEAR, month: MONTH } } });
    before.set(a.id, { code: a.code, pc: b?.projectCode ?? "-", rental: b?.rentalAmountCents ?? 0, fuelL: b?.fuelLitres ?? 0, fuelC: b?.fuelCostCents ?? 0, grand: b?.grandTotalCents ?? 0 });
  }

  if (!APPLY) {
    console.log("Planned: delete each vehicle's CEP-03W June assignment, then regenerate (→ CEP-03E).\n");
    for (const a of assets) {
      const bf = before.get(a.id)!;
      console.log(`  ${a.code.padEnd(9)} now @${bf.pc}  rental ${rs(bf.rental)}  fuel ${bf.fuelL}L/${rs(bf.fuelC)}  grand ${rs(bf.grand)}`);
    }
    console.log("\nPass --apply to write.");
    await prisma.$disconnect();
    return;
  }

  // 1) Drop the spurious CEP-03W June assignment for each vehicle.
  const del = await prisma.assetAssignment.deleteMany({
    where: { assetId: { in: assetIds }, projectId: W.id, startDate: { lte: JUN_END }, OR: [{ endDate: null }, { endDate: { gte: JUN_START } }] },
  });
  console.log(`Deleted ${del.count} CEP-03W June assignment rows.\n`);

  // 2) Regenerate the 10 bills (DRAFT) — now single-segment CEP-03E.
  const res = await generateBillsForMonth({ year: YEAR, month: MONTH, assetIds, regenerate: true, actorId: null });
  console.log(`Regenerated: created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, skipped ${res.skippedExisting + res.skippedFinalized}, errors ${res.errors.length}`);
  if (res.errors.length) for (const e of res.errors) console.log("   ERROR", e.assetCode, e.message);
  console.log();

  // 3) AFTER + delta
  let sumBeforeGrand = 0, sumAfterGrand = 0;
  console.log("vehicle    | before → after site | rental | fuel L / cost | grand (Δ)");
  for (const a of assets) {
    const bf = before.get(a.id)!;
    const b = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: YEAR, month: MONTH } }, include: { lineItems: true } });
    sumBeforeGrand += bf.grand; sumAfterGrand += b?.grandTotalCents ?? 0;
    const d = (b?.grandTotalCents ?? 0) - bf.grand;
    console.log(`  ${a.code.padEnd(9)} ${bf.pc}→${b?.projectCode}  ${rs(b?.rentalAmountCents ?? 0).padStart(12)}  ${(b?.fuelLitres ?? 0)}L/${rs(b?.fuelCostCents ?? 0)}  ${rs(b?.grandTotalCents ?? 0)} (Δ${rs(d)})`);
  }
  console.log(`\nSum grand before ${rs(sumBeforeGrand)}  →  after ${rs(sumAfterGrand)}  (Δ ${rs(sumAfterGrand - sumBeforeGrand)})`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
