import { prisma } from "../src/lib/db";
import { resolvePeriod } from "../src/lib/billing/period";
import { generateBillForAsset } from "../src/lib/billing/generate";
import { getMonthSegments } from "../src/lib/assignments";
import { renderInvoicePdfBuffer } from "../src/lib/billing/invoice-document";
import fs from "fs";
import path from "path";

// Bill one site for one month, and put the invoices on disk.
//
// The billing console does this for the whole fleet behind a login. Sometimes
// the question is smaller and more urgent: "what does this site owe for May,
// and can I have the PDF". Generating the fleet to answer that also drafts
// bills for every other site, which is not what was asked.
//
// A bill is drafted per VEHICLE, because that is the unit a rate card and a
// meter belong to; the site total is their sum. Both come out below, and the
// PDFs are the same documents the /billing screen serves.
//
// Bills are left in DRAFT. Nothing here issues an invoice or assigns an invoice
// number — that is a deliberate act with a number sequence behind it.
//
//   npx tsx scripts/bill_site_month.ts --site=CEP-03F --month=2026-05
//   npx tsx scripts/bill_site_month.ts --site=CEP-03F --month=2026-05 --apply
//   npx tsx scripts/bill_site_month.ts --site=CEP-03F --month=2026-05 --apply --regenerate

const APPLY = process.argv.includes("--apply");
const REGENERATE = process.argv.includes("--regenerate");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const MONTH = arg("month");
const OUT = arg("out") || "out/bills";

const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });

async function main() {
  if (!SITE || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) throw new Error("need --site=CODE --month=YYYY-MM");
  const [year, month] = MONTH.split("-").map(Number);
  const period = resolvePeriod(year, month);

  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`\n=== bill ${SITE} for ${MONTH} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  console.log(`  period  : ${period.start.toLocaleString("en-CA", { timeZone: "Asia/Colombo" })}`);
  console.log(`         .. ${period.end.toLocaleString("en-CA", { timeZone: "Asia/Colombo" })}  (Colombo)`);

  const project = await prisma.project.findUnique({ where: { code: SITE }, select: { id: true, code: true, name: true } });
  if (!project) throw new Error(`site ${SITE} not found`);

  // Bill whoever was POSTED here in the month. A vehicle that merely drew fuel
  // from this pump belongs to whichever site it was posted to, and billing it
  // here would charge this site for another site's machine.
  const posted = await prisma.assetAssignment.findMany({
    where: { projectId: project.id, startDate: { lte: period.end },
      OR: [{ endDate: null }, { endDate: { gte: period.start } }] },
    select: { assetId: true }, distinct: ["assetId"] });
  if (!posted.length) { console.log(`\n  nobody was posted to ${project.name} in ${MONTH}.\n`); return; }

  const assets = await prisma.asset.findMany({
    where: { id: { in: posted.map((p) => p.assetId) } },
    select: { id: true, code: true, regNo: true, rentalRate: { select: { assetId: true } }, billFuelOnly: true },
    orderBy: { code: "asc" } });

  console.log(`\n  ${project.name} · ${assets.length} vehicle(s) posted here\n`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  const made: { id: string; code: string }[] = [];
  let noRate = 0, notHere = 0;

  for (const a of assets) {
    // Only the days at THIS site are this site's to bill; the resolver already
    // splits a shared month, so a bill is skipped here only when the vehicle
    // ended up owing this site nothing at all.
    const segs = await getMonthSegments(a.id, period.start, period.end);
    const days = segs.filter((s) => s.projectId === project.id).reduce((n, s) => n + s.days, 0);
    if (!days) { notHere++; continue; }
    if (!a.rentalRate && !a.billFuelOnly) {
      console.log(`  ${a.code.padEnd(12)}${String(days).padStart(3)} days   NO RATE CARD — bills nothing, skipped`);
      noRate++;
      continue;
    }
    if (!APPLY) { console.log(`  ${a.code.padEnd(12)}${String(days).padStart(3)} days   would draft a bill`); continue; }

    const r = await generateBillForAsset(a.id, period, { regenerate: REGENERATE, actorId: admin?.id ?? null });
    if (r.billId) made.push({ id: r.billId, code: a.code });
    console.log(`  ${a.code.padEnd(12)}${String(days).padStart(3)} days   ${r.status}`);
  }

  if (!APPLY) {
    console.log(`\n  ${assets.length - noRate - notHere} bill(s) to draft` +
      `${noRate ? `, ${noRate} skipped for no rate card` : ""}${notHere ? `, ${notHere} owed this site no days` : ""}`);
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`);
    return;
  }

  const bills = await prisma.bill.findMany({
    where: { year, month, projectId: project.id }, include: { lineItems: true }, orderBy: { assetCode: "asc" } });
  if (!bills.length) { console.log(`\n  no bills landed for this site.\n`); return; }

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\n--- ${project.name} · ${MONTH} ---`);
  let sub = 0, sscl = 0, vat = 0, grand = 0, litres = 0;
  for (const b of bills) {
    const unit = b.billingMode === "perkm" ? "km" : b.billingMode === "hourly" ? "h" : "d";
    console.log(`  ${b.assetCode.padEnd(12)}${(b.billingMode + "/" + b.rateBasis).padEnd(11)}` +
      `min ${(n1(b.minimumUnits) + unit).padEnd(9)}billed ${(n1(b.billableUnits) + unit).padEnd(11)}` +
      `${rs(b.rentalAmountCents).padStart(16)} rental  ${rs(b.fuelCostCents).padStart(14)} fuel  ${rs(b.grandTotalCents).padStart(16)}`);
    sub += b.subtotalCents; sscl += b.ssclCents; vat += b.vatCents; grand += b.grandTotalCents; litres += b.fuelLitres;

    const buf = await renderInvoicePdfBuffer(b);
    const file = path.join(OUT, `invoice_${b.assetCode}_${b.periodKey}.pdf`);
    fs.writeFileSync(file, buf);
    console.log(`  ${" ".repeat(12)}${file}`);
  }

  console.log(`\n  ${bills.length} bill(s) · ${n1(litres)} L of fuel`);
  console.log(`  subtotal ${rs(sub)}   SSCL ${rs(sscl)}   VAT ${rs(vat)}`);
  console.log(`  SITE TOTAL ${rs(grand)}`);
  console.log(`\n  Left in DRAFT — no invoice number assigned. Issue them from /billing.\n`);
}

main().finally(() => prisma.$disconnect());
