import { prisma } from "../src/lib/db";
import { generateBillsForMonth, generateBillForAsset } from "../src/lib/billing/generate";
import { resolvePeriod } from "../src/lib/billing/period";

// Build Inginimitiya (INGI) June 2026 as a 4-vehicle site and consolidate BM-02's
// fuel onto Lot-04.
//  • Move HCC-03 (490 L) and DT-74 (90 L) in from CEP-03W (they fuelled 100% at
//    Inginimitiya): drop their CEP-03W June assignment so INGI is the sole segment.
//    ZB-1521 and MB-29 already bill at INGI.
//  • BM-02 (issued at Lot-04, fuel split 15 L Ingi + 20 L Lot-02 + 60 L Lot-04):
//    drop its BATTI-02 and INGI June assignments so it is single-site Lot-04, and
//    all 95 L of fuel is charged to Lot-04. Re-issued keeping its invoice number;
//    grand total unchanged (only the fuel attribution consolidates).
//
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const Y = 2026, M = 6;
const JS = new Date("2026-05-31T18:30:00.000Z");
const JE = new Date("2026-06-30T18:29:59.999Z");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function main() {
  const INGI = await prisma.project.findUnique({ where: { code: "INGI" } });
  const CEPW = await prisma.project.findUnique({ where: { code: "CEP-03W" } });
  const IRD = await prisma.project.findUnique({ where: { code: "IRD-04" } });
  if (!INGI || !CEPW || !IRD) throw new Error("project missing");
  console.log(`Inginimitiya build — ${APPLY ? "APPLY" : "dry-run"}\n`);

  // --- Move HCC-03, DT-74 → INGI ---
  const ingiIds: string[] = [];
  for (const code of ["HCC-03", "DT-74"]) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (!a) throw new Error(code + " missing");
    console.log(`MOVE ${code} CEP-03W → INGI`);
    if (APPLY) {
      await prisma.assetAssignment.deleteMany({ where: { assetId: a.id, projectId: CEPW.id, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
      ingiIds.push(a.id);
    }
  }
  // Keep ZB-1521, MB-29 (already INGI) — regenerate them too for consistency.
  for (const code of ["ZB-1521", "MB-29"]) {
    const a = await prisma.asset.findFirst({ where: { code } });
    if (a) ingiIds.push(a.id);
  }

  // --- BM-02: consolidate all fuel to Lot-04 (single-site IRD-04) ---
  const bm = await prisma.asset.findFirst({ where: { code: "BM-02" } });
  const bmBill = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: bm!.id, year: Y, month: M } } });
  console.log(`\nBM-02 before: @${bmBill?.projectCode}/${bmBill?.status} inv=${bmBill?.invoiceNumber} ${rs(bmBill?.grandTotalCents ?? 0)}`);

  if (!APPLY) { console.log("\nDry-run. Pass --apply."); await prisma.$disconnect(); return; }

  // Regenerate INGI vehicles
  const res = await generateBillsForMonth({ year: Y, month: M, assetIds: ingiIds, regenerate: true, actorId: null });
  console.log(`\nINGI regenerated: created ${res.created}, regenerated ${res.regenerated}, errors ${res.errors.length}`);
  for (const e of res.errors) console.log("   ERROR", e.assetCode, e.message);

  // BM-02: drop BATTI-02 + INGI assignments, keep only IRD-04; unlock, regen, re-issue.
  await prisma.assetAssignment.deleteMany({ where: { assetId: bm!.id, projectId: { not: IRD.id }, startDate: { lte: JE }, OR: [{ endDate: null }, { endDate: { gte: JS } }] } });
  await prisma.bill.update({ where: { id: bmBill!.id }, data: { status: "DRAFT" } });
  await generateBillForAsset(bm!.id, resolvePeriod(Y, M), { regenerate: true, actorId: null });
  const nb = await prisma.bill.findUnique({ where: { assetId_year_month: { assetId: bm!.id, year: Y, month: M } }, include: { lineItems: true } });
  await prisma.bill.update({ where: { id: nb!.id }, data: { status: "ISSUED", invoiceNumber: bmBill!.invoiceNumber, issuedDate: bmBill!.issuedDate ?? new Date() } });
  console.log(`BM-02 after: @${nb!.projectCode}/ISSUED inv=${bmBill!.invoiceNumber} ${rs(nb!.grandTotalCents)} — fuel ${nb!.fuelLitres}L`);
  for (const li of nb!.lineItems) console.log(`   ${li.kind.padEnd(7)} ${(li.projectName || "-").padEnd(22)} ${rs(li.amountCents)}`);

  // INGI final list
  const bills = await prisma.bill.findMany({ where: { projectCode: "INGI", year: Y, month: M }, orderBy: { grandTotalCents: "desc" } });
  let sum = 0;
  console.log(`\n=== Inginimitiya — ${bills.length} bills ===`);
  for (const b of bills) { sum += b.grandTotalCents; console.log(`  ${b.assetCode.padEnd(9)} ${b.status.padEnd(6)} fuel ${b.fuelLitres}L  ${rs(b.grandTotalCents)}`); }
  console.log(`  INGI total: ${rs(sum)}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
