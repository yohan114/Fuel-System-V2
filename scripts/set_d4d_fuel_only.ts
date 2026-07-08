import { prisma } from "../src/lib/db";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";

// D4D-01/02/03 are hired Backhoe Loaders at CEP-03F Galagedara whose RENTAL is
// billed externally (outside E&C). E&C only fuels them from the site tank, so
// their bill must charge the issued fuel only — no rental. This flags them
// fuel-only (like PE-3723) and regenerates their existing DRAFT bills.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const CODES = ["D4D-01", "D4D-02", "D4D-03"];

function rs(c: number) { return "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function main() {
  for (const code of CODES) {
    const asset = await prisma.asset.findUnique({ where: { code } });
    if (!asset) { console.log(`${code}: not found`); continue; }
    console.log(`\n${code} — ownership ${asset.ownership} · billFuelOnly ${asset.billFuelOnly}`);

    if (!asset.billFuelOnly) {
      if (APPLY) {
        await prisma.asset.update({ where: { id: asset.id }, data: { billFuelOnly: true } });
        await prisma.auditLog.create({
          data: {
            actorId: null, action: "UPDATE", entity: "Asset", entityId: asset.id,
            summary: `Flagged ${code} as fuel-only (hired Backhoe Loader — rental billed externally, E&C recharges fuel only)`,
          },
        });
        console.log(`  → set billFuelOnly = true`);
      } else {
        console.log(`  → WOULD set billFuelOnly = true`);
      }
    }

    // Regenerate every existing bill for this asset so it becomes fuel-only.
    const bills = await prisma.bill.findMany({ where: { assetId: asset.id }, select: { year: true, month: true, status: true } });
    for (const b of bills) {
      if (b.status !== "DRAFT") { console.log(`  [${b.year}-${String(b.month).padStart(2,"0")}] ${b.status} — skipped (not a draft)`); continue; }
      if (!APPLY) { console.log(`  [${b.year}-${String(b.month).padStart(2,"0")}] would regenerate → fuel-only`); continue; }
      const res = await generateBillForAsset(asset.id, resolvePeriod(b.year, b.month), { regenerate: true, actorId: null });
      const bill = res.billId ? await prisma.bill.findUnique({ where: { id: res.billId }, include: { lineItems: true } }) : null;
      if (bill) {
        const rentalLines = bill.lineItems.filter((l) => l.kind === "RENTAL").length;
        console.log(`  [${b.year}-${String(b.month).padStart(2,"0")}] ${res.status}: fuel ${bill.fuelLitres}L ${rs(bill.fuelCostCents)} · rental ${rs(bill.rentalAmountCents)} (${rentalLines} rental lines) · grand ${rs(bill.grandTotalCents)}`);
      }
    }
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
