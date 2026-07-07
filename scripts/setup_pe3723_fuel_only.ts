import { prisma } from "../src/lib/db";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";

// One-off setup for PE-3723 — a privately-owned survey vehicle (Mr Chinthaka,
// Surveyor Officer) on the CEP-03F Galagedara site. E&C does not rent this
// vehicle but issues it diesel from the site tank, so it must be billed for the
// issued FUEL ONLY (no rental line, no rate card). This flags the asset
// fuel-only and (re)generates its DRAFT monthly bills so the fuel-only invoice
// can be verified.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const CODE = "PE-3723";
// Colombo issue dates land in two calendar months (27 Jun, 1 Jul), so bill both.
const MONTHS: [number, number][] = [
  [2026, 6],
  [2026, 7],
];

function rs(cents: number): string {
  return "Rs " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const asset = await prisma.asset.findUnique({
    where: { code: CODE },
    include: { project: true, rentalRate: true },
  });
  if (!asset) throw new Error(`${CODE} not found`);

  console.log(`${CODE} — ${asset.project?.name ?? "no site"} · ownership ${asset.ownership} · rate card: ${asset.rentalRate ? "yes" : "none"} · billFuelOnly=${asset.billFuelOnly}`);

  if (!asset.billFuelOnly) {
    if (APPLY) {
      await prisma.asset.update({ where: { id: asset.id }, data: { billFuelOnly: true } });
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: "UPDATE",
          entity: "Asset",
          entityId: asset.id,
          summary: `Flagged ${CODE} as fuel-only (private vehicle — E&C bills issued fuel only, no rental)`,
        },
      });
      console.log(`  → set billFuelOnly = true`);
    } else {
      console.log(`  → WOULD set billFuelOnly = true`);
    }
  }

  for (const [year, month] of MONTHS) {
    const period = resolvePeriod(year, month);
    if (!APPLY) {
      console.log(`\n[${period.periodKey}] dry-run — pass --apply to generate the DRAFT bill.`);
      continue;
    }
    const res = await generateBillForAsset(asset.id, period, { regenerate: true, actorId: null });
    if (res.status === "no-rate") {
      console.log(`\n[${period.periodKey}] ${res.status} — (unexpected for a fuel-only asset)`);
      continue;
    }
    const bill = res.billId
      ? await prisma.bill.findUnique({ where: { id: res.billId }, include: { lineItems: true } })
      : null;
    console.log(`\n[${period.periodKey}] ${res.status}`);
    if (bill) {
      for (const li of bill.lineItems) {
        console.log(`   ${li.kind.padEnd(10)} ${li.description}`);
        console.log(`   ${"".padEnd(10)} ${li.quantity} ${li.unit} × ${rs(li.unitRateCents)} = ${rs(li.amountCents)}`);
      }
      console.log(`   ${"—".repeat(40)}`);
      console.log(`   Subtotal   ${rs(bill.subtotalCents)}`);
      console.log(`   SSCL ${(bill.ssclRate * 100).toFixed(1)}%   ${rs(bill.ssclCents)}`);
      console.log(`   VAT  ${(bill.vatRate * 100).toFixed(0)}%   ${rs(bill.vatCents)}`);
      console.log(`   GRAND      ${rs(bill.grandTotalCents)}`);
      const rentalLines = bill.lineItems.filter((l) => l.kind === "RENTAL").length;
      console.log(`   [check] RENTAL lines = ${rentalLines} (expected 0); rentalAmountCents = ${bill.rentalAmountCents} (expected 0)`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
