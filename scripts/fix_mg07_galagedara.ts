import { prisma } from "../src/lib/db";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";

// Adjust MG-07's Galagedara stint from 5 days (June 20-24) back to 7 days
// (June 24-30) so Galagedara's line-item total is Rs 2,955,032.28 (MG-07's
// original Rs 141,293.79 share). E absorbs the other 23 days. MG-07's total
// invoice is unchanged (E+F = 120 hr = Rs 508,498); only the E/F split moves.
// Re-issues keeping invoice EC-INV-2026-0050.
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const F_START = new Date("2026-06-23T18:30:00.000Z"); // June 24 00:00 Colombo
const F_END = new Date("2026-06-30T18:29:59.999Z");   // June 30 end Colombo
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const a = await prisma.asset.findFirst({ where: { code: "MG-07" } });
  if (!a) throw new Error("MG-07 not found");
  const F = await prisma.project.findUnique({ where: { code: "CEP-03F" } });
  if (!F) throw new Error("CEP-03F missing");

  const bill = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: 2026, month: 6 } } });
  console.log(`MG-07 before: @${bill?.projectCode}/${bill?.status} inv=${bill?.invoiceNumber} ${rs(bill?.grandTotalCents ?? 0)}`);

  const fAsg = await prisma.assetAssignment.findFirst({
    where: { assetId: a.id, projectId: F.id, startDate: { lte: F_END }, OR: [{ endDate: null }, { endDate: { gte: new Date("2026-05-31T18:30:00.000Z") } }] },
  });
  console.log(`CEP-03F assignment now: ${fAsg?.startDate.toISOString().slice(0, 10)} → ${fAsg?.endDate?.toISOString().slice(0, 10)} → changing to 2026-06-24 → 2026-06-30`);
  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  await prisma.assetAssignment.update({ where: { id: fAsg!.id }, data: { startDate: F_START, endDate: F_END } });

  // Unlock, regenerate, re-issue keeping the invoice number.
  const invNo = bill!.invoiceNumber, issued = bill!.issuedDate;
  await prisma.bill.update({ where: { id: bill!.id }, data: { status: "DRAFT" } });
  await generateBillForAsset(a.id, resolvePeriod(2026, 6), { regenerate: true, actorId: null });
  const nb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: a.id, year: 2026, month: 6 } }, include: { lineItems: true } });
  await prisma.bill.update({ where: { id: nb!.id }, data: { status: "ISSUED", invoiceNumber: invNo, issuedDate: issued ?? new Date() } });

  console.log(`\nMG-07 after: @${nb!.projectCode}/ISSUED inv=${invNo} ${rs(nb!.grandTotalCents)}`);
  for (const li of nb!.lineItems.sort((x, y) => (x.projectName || "").localeCompare(y.projectName || "")))
    console.log(`   ${li.kind.padEnd(7)} ${(li.projectName || "-").padEnd(22)} ${li.quantity} ${li.unit}  ${rs(li.amountCents)}`);

  // Galagedara line-item total check
  const gal = await prisma.$queryRawUnsafe<any[]>(`SELECT COALESCE(SUM(li.amountCents),0) sub FROM BillLineItem li JOIN Bill b ON b.id=li.billId WHERE li.projectName LIKE '%Galagedara%' AND b.year=2026 AND b.month=6 AND li.kind IN ('RENTAL','FUEL')`);
  console.log(`\nGalagedara line-item subtotal (pre-tax): ${rs(Number(gal[0].sub))}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
