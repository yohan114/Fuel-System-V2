/**
 * Regenerate every bill for one or more months, and show what moved.
 *
 * Regeneration is not idempotent in the interesting sense: the generator reads
 * today's fuel, meters, postings and rate cards, so a month rebuilt after new
 * sheets have landed is a different month. This prints the before/after by site
 * rather than a bare "done", because the number that matters is which site's
 * total changed and by how much.
 *
 * ISSUED and PAID invoices are left alone by the generator — those have gone to
 * a client and are a credit note's business, not a rebuild's.
 *
 *   npx tsx scripts/regen-months.ts 2026 6 7
 */
import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

const year = parseInt(process.argv[2] || "2026", 10);
const months = process.argv.slice(3).map((m) => parseInt(m, 10));
if (months.length === 0) {
  console.error("usage: npx tsx scripts/regen-months.ts <year> <month> [month...]");
  process.exit(1);
}

const rs = (c: number) => Math.round(c / 100).toLocaleString("en-LK");
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);

type Snap = Map<string, { n: number; cents: number }>;

async function snapshot(periodKey: string): Promise<Snap> {
  const bills = await prisma.bill.findMany({
    where: { periodKey },
    select: { projectCode: true, grandTotalCents: true },
  });
  const m: Snap = new Map();
  for (const b of bills) {
    const k = b.projectCode || "(unassigned)";
    const e = m.get(k) ?? { n: 0, cents: 0 };
    e.n++;
    e.cents += b.grandTotalCents;
    m.set(k, e);
  }
  return m;
}

const sum = (s: Snap) => [...s.values()].reduce((t, e) => t + e.cents, 0);
const count = (s: Snap) => [...s.values()].reduce((t, e) => t + e.n, 0);

async function main() {
  for (const month of months) {
    const periodKey = `${year}-${String(month).padStart(2, "0")}`;
    const before = await snapshot(periodKey);

    console.log(`\n════════ ${periodKey} ════════`);
    const t0 = Date.now();
    const r = await generateBillsForMonth({ year, month, regenerate: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);

    console.log(
      `  created ${r.created} · regenerated ${r.regenerated} · not-here ${r.skippedNotHere}` +
        ` · finalized ${r.skippedFinalized} · billed-direct ${r.skippedBilledDirect}` +
        ` · no-rate ${r.noRate} · errors ${r.errors.length}   (${secs}s)`
    );

    if (r.noRate > 0) {
      const codes = r.assets.filter((a) => a.status === "no-rate").map((a) => a.assetCode);
      console.log(`  no rate card: ${codes.join(", ")}`);
    }
    for (const e of r.errors) console.log(`  ERROR ${e.assetCode}: ${e.message}`);

    const after = await snapshot(periodKey);
    const sites = [...new Set([...before.keys(), ...after.keys()])].sort();

    console.log(`\n  ${pad("Site", 15)}${padL("bills", 6)}${padL("was", 16)}${padL("now", 16)}${padL("change", 16)}`);
    for (const s of sites) {
      const b = before.get(s) ?? { n: 0, cents: 0 };
      const a = after.get(s) ?? { n: 0, cents: 0 };
      const d = a.cents - b.cents;
      const mark = d === 0 ? "" : d > 0 ? "  ▲" : "  ▼";
      console.log(
        `  ${pad(s, 15)}${padL(`${b.n}→${a.n}`, 6)}${padL(rs(b.cents), 16)}${padL(rs(a.cents), 16)}` +
          `${padL(d === 0 ? "—" : (d > 0 ? "+" : "-") + rs(Math.abs(d)), 16)}${mark}`
      );
    }
    const db = sum(before), da = sum(after);
    console.log(
      `  ${pad("TOTAL", 15)}${padL(`${count(before)}→${count(after)}`, 6)}${padL(rs(db), 16)}${padL(rs(da), 16)}` +
        `${padL(da === db ? "—" : (da > db ? "+" : "-") + rs(Math.abs(da - db)), 16)}`
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
