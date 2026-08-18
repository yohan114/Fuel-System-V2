import { prisma } from "../src/lib/db";

// Muthur dry-hire-with-fuel-on-account: three portable machines are billed on
// their DRY day rate (client-style dry hire) but E&C supplied the diesel and
// wants it recovered. Keep the dry rental untouched and add the issued fuel as a
// charged FUEL line, then recompute subtotal/SSCL/VAT/grand so the bill invariant
// (subtotal == Σ RENTAL+FUEL) still holds. June DRAFT bills only; locked right after.
//
// Dry-run by default; pass --apply to write.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const CODES = ["AC-42", "GE-121", "WG-63"];
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  console.log(`Muthur dry+fuel — ${APPLY ? "APPLY" : "dry-run"}\n`);
  for (const code of CODES) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) throw new Error("not found: " + code);
    const bill = await prisma.bill.findFirst({ where: { assetId: a.id, year: Y, month: M }, include: { lineItems: true } });
    if (!bill) { console.log(`${code}: no bill`); continue; }
    if (bill.status !== "DRAFT") { console.log(`${code}: not DRAFT (${bill.status}) — skip`); continue; }

    // Recorded fuel for the month (issued diesel E&C supplied).
    const fu = await prisma.fuelIssue.aggregate({
      where: { assetId: a.id, voided: false, issueDate: { gte: JS, lte: JE } },
      _sum: { litres: true, totalCost: true },
    });
    const litres = fu._sum.litres ?? 0;
    const fuelCents = fu._sum.totalCost ?? 0;
    if (litres <= 0 || fuelCents <= 0) { console.log(`${code}: no fuel — skip`); continue; }

    const already = bill.lineItems.some((l) => l.kind === "FUEL");
    const rentalCents = bill.lineItems.filter((l) => l.kind === "RENTAL").reduce((s, l) => s + l.amountCents, 0);
    const subtotal = rentalCents + fuelCents;
    const sscl = Math.round(subtotal * bill.ssclRate);
    const vat = Math.round((subtotal + sscl) * bill.vatRate);
    const grand = subtotal + sscl + vat;

    console.log(`${code}: rental ${rs(rentalCents)} + fuel ${litres}L ${rs(fuelCents)} → subtotal ${rs(subtotal)}  grand ${rs(bill.grandTotalCents)} → ${rs(grand)}${already ? "  [FUEL line already present!]" : ""}`);

    if (APPLY && !already) {
      await prisma.$transaction([
        prisma.billLineItem.create({
          data: {
            billId: bill.id,
            kind: "FUEL",
            description: `Fuel issued — ${bill.projectCode} (dry hire, fuel on account)`,
            quantity: litres,
            unit: "L",
            unitRateCents: Math.round(fuelCents / litres),
            amountCents: fuelCents,
            projectId: bill.projectId,
            projectName: bill.projectName,
          },
        }),
        prisma.bill.update({
          where: { id: bill.id },
          data: { fuelLitres: litres, fuelCostCents: fuelCents, subtotalCents: subtotal, ssclCents: sscl, vatCents: vat, grandTotalCents: grand },
        }),
      ]);
    }
  }
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
