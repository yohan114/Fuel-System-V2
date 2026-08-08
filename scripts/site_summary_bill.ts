import { buildSiteSummary } from "../src/lib/billing/site-summary";
import { renderSiteSummaryPdf } from "../src/lib/billing/site-summary-document";
import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// One site, one month, one page — counted from that site's own books.
//
//   npx tsx scripts/site_summary_bill.ts --site=CEP-03F --month=2026-05
//   npx tsx scripts/site_summary_bill.ts --site=CEP-03F --month=2026-05 --out=out/bills

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const MONTH = arg("month");
const OUT = arg("out") || "out/bills";

const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number) => x.toLocaleString("en-LK", { maximumFractionDigits: 1 });

async function main() {
  if (!SITE || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) throw new Error("need --site=CODE --month=YYYY-MM");
  const [year, month] = MONTH.split("-").map(Number);

  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  console.log(`\n=== site summary bill · ${SITE} · ${MONTH} ===`);
  console.log(`  database: ${path.resolve(process.cwd(), url.replace(/^file:/, ""))}`);

  const sum = await buildSiteSummary(SITE, year, month);
  if (!sum.lines.length) { console.log(`\n  nobody was posted to ${sum.siteName} in ${MONTH}.\n`); return; }

  console.log(`\n  ${sum.siteName} · ${sum.monthLabel} · ${sum.daysInMonth} days in month\n`);
  console.log(`  ${"machine".padEnd(20)}${"days".padStart(8)}${"cons typ".padStart(13)}${"meter".padStart(12)}${"billable".padStart(13)}` +
    `${"rate".padStart(12)}${"rental".padStart(16)}${"fuel".padStart(11)}${"total".padStart(16)}`);
  for (const l of sum.lines) {
    console.log(`  ${(l.code + " / " + (l.regNo ?? "—")).padEnd(20)}${`${l.daysHere}/${l.daysInMonth}`.padStart(8)}` +
      `${(l.consRefUnits != null ? `${n1(l.consRefUnits)} ${l.unit}` : "—").padStart(13)}` +
      `${(l.actualUnits != null ? `${n1(l.actualUnits)} ${l.unit}` : "—").padStart(12)}` +
      `${`${n1(l.billableUnits)} ${l.unit}`.padStart(13)}` +
      `${(l.rateCents != null ? rs(l.rateCents) : "no rate").padStart(12)}${rs(l.rentalCents).padStart(16)}` +
      `${`${n1(l.fuelLitres)} L`.padStart(11)}${rs(l.lineTotalCents).padStart(16)}`);
  }

  console.log(`\n  rental                 ${rs(sum.rentalCents)}`);
  console.log(`  fuel (${n1(sum.fuelLitres)} L, this site's pumps)  ${rs(sum.fuelCostCents)}`);
  console.log(`  subtotal               ${rs(sum.subtotalCents)}`);
  console.log(`  SSCL ${(sum.ssclRate * 100).toFixed(1)}%             ${rs(sum.ssclCents)}`);
  console.log(`  VAT ${(sum.vatRate * 100).toFixed(1)}%              ${rs(sum.vatCents)}`);
  console.log(`  SITE TOTAL             ${rs(sum.grandTotalCents)}`);
  if (sum.unrated.length) console.log(`\n  no rate card, no rental charged: ${sum.unrated.join(", ")}`);

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `site-summary_${sum.siteCode}_${sum.periodKey}.pdf`);
  fs.writeFileSync(file, await renderSiteSummaryPdf(sum));
  console.log(`\n  wrote ${file}\n`);
}

main().finally(() => prisma.$disconnect());
