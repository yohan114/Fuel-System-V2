import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";
import { assignedDaysFromLines, effectiveMinimumUnits } from "../src/lib/billing/site-split";

// Regenerate the CEP-03F Galagedara occupancy bills (May–Jul 2026) so they pick
// up availability-prorated minimums: allocation date = first fuel issue, and the
// guaranteed minimum = full minimum × days-on-site ÷ days-in-month. DRAFT only.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const MONTHS: [number, number][] = [[2026, 5], [2026, 6], [2026, 7]];

function u(mode: string) { return mode === "perkm" ? "km" : mode === "perday" ? "day" : "hr"; }

async function main() {
  const proj = await prisma.project.findUnique({ where: { code: "CEP-03F" } });
  if (!proj) throw new Error("CEP-03F not found");
  const assigned = await prisma.assetAssignment.findMany({
    where: { projectId: proj.id }, select: { assetId: true }, distinct: ["assetId"],
  });
  const assetIds = assigned.map((a) => a.assetId);
  console.log(`CEP-03F Galagedara — ${assetIds.length} assigned vehicles; regenerating ${MONTHS.map(([y, m]) => `${y}-${m}`).join(", ")}\n`);

  for (const [year, month] of MONTHS) {
    if (!APPLY) {
      console.log(`[${year}-${String(month).padStart(2, "0")}] dry-run — pass --apply to (re)generate.`);
      continue;
    }
    const res = await generateBillsForMonth({ year, month, assetIds, regenerate: true, actorId: null });
    console.log(`[${year}-${String(month).padStart(2, "0")}] created ${res.created}, regenerated ${res.regenerated}, no-rate ${res.noRate}, skipped ${res.skippedExisting + res.skippedFinalized}, errors ${res.errors.length}`);

    // Show each Galagedara bill's proration for this month.
    const daysInMonth = new Date(year, month, 0).getDate();
    const bills = await prisma.bill.findMany({
      where: { year, month, assetId: { in: assetIds }, projectCode: "CEP-03F" },
      include: { lineItems: true }, orderBy: { assetCode: "asc" },
    });
    for (const b of bills) {
      const days = assignedDaysFromLines(b.lineItems);
      const effMin = effectiveMinimumUnits(b.lineItems, b.minimumUnits, daysInMonth);
      const unit = u(b.billingMode);
      const fuelL = b.fuelLitres;
      console.log(
        `   ${b.assetCode.padEnd(9)} ${String(days).padStart(2)}/${daysInMonth}d  min ${effMin.toFixed(1).padStart(7)} ${unit} (of ${b.minimumUnits})  ` +
        `billable ${b.billableUnits.toFixed(1).padStart(7)} ${unit}  rental Rs ${(b.rentalAmountCents/100).toLocaleString().padStart(11)}  ` +
        `fuel ${fuelL.toFixed(0).padStart(4)}L Rs ${(b.fuelCostCents/100).toLocaleString().padStart(9)}  grand Rs ${(b.grandTotalCents/100).toLocaleString()}`
      );
    }
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
