/**
 * Does every per-site row multiply out?
 *
 * The check the owner performed by hand: take the units a site is shown and the
 * rate beside them, multiply, and see whether it equals the rental charged.
 * It did not, for PC-02 at Wadakada — 4 hr at Rs 4,650 against a charge of
 * Rs 14,941.94 — because the rate column carried the bill's dominant rate while
 * the money came from a dry-hire segment at Rs 3,860.
 *
 *   npx tsx scripts/verify-site-rates.ts 2026 5 6 7 8
 */
import { loadConsolidatedBilling } from "../src/lib/billing/consolidated-data";
import { prisma } from "../src/lib/db";

const year = parseInt(process.argv[2] || "2026", 10);
const months = process.argv.slice(3).map((m) => parseInt(m, 10));
const rs = (c: number) => (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  let checked = 0, bad = 0, blended = 0;
  const offenders: string[] = [];

  for (const m of months.length ? months : [5, 6, 7, 8]) {
    const all = await loadConsolidatedBilling(year, m, null);
    for (const b of all.bills as any[]) {
      if (!b.rentalAmountCents || !b.billableUnits) continue;
      checked++;
      // A weighted rate is an average by construction; it cannot land on the
      // cent and is marked "avg" on the page rather than pretending to.
      if (b.rateBlended) { blended++; continue; }
      const implied = Math.round(b.billableUnits * b.rateCents);
      if (Math.abs(implied - b.rentalAmountCents) > 2) {
        bad++;
        if (offenders.length < 10) {
          offenders.push(
            `  ${year}-${String(m).padStart(2, "0")} ${b.assetCode} @ ${b.projectCode}: ` +
            `${b.billableUnits} × ${rs(b.rateCents)} = ${rs(implied)}, charged ${rs(b.rentalAmountCents)}`,
          );
        }
      }
    }
  }

  console.log(`\n  per-site rows with rental      ${checked}`);
  console.log(`  weighted (avg) rates, flagged  ${blended}`);
  console.log(`  rows that do NOT multiply out  ${bad}`);
  for (const o of offenders) console.log(o);
  console.log(bad === 0 ? "\n  ✓ every row reconciles\n" : "\n  ✗ see above\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
