/**
 * One consolidated billing PDF per site for a month, plus an all-sites copy.
 *
 * Named the way the owner's own folders are — CEP-03E_July2026.pdf — so a new
 * month drops straight in beside the last.
 *
 * Bills come through loadConsolidatedBilling, so a vehicle that worked several
 * sites in the month appears under EVERY site it worked, carrying only its own
 * portion: rental, fuel, and the tax apportioned by value. A site therefore
 * never sees days another site had the machine, and the per-site totals still
 * add back to the month exactly.
 *
 * Drafts are included. Every bill in the system is currently DRAFT, and the
 * point of these PDFs is to check the figures before issuing.
 *
 *   npx tsx scripts/export-site-bills.tsx 2026 7
 *   npx tsx scripts/export-site-bills.tsx 2026 7 CEP-03E KARA ING
 */
import { prisma } from "../src/lib/db";
import { loadConsolidatedBilling } from "../src/lib/billing/consolidated-data";
import { ConsolidatedDocument } from "../src/lib/billing/consolidated-document";
import { renderToBuffer } from "@react-pdf/renderer";
import * as fs from "fs";
import * as path from "path";

const year = parseInt(process.argv[2] || "2026", 10);
const month = parseInt(process.argv[3] || "7", 10);
const onlyCodes = process.argv.slice(4);

const periodKey = `${year}-${String(month).padStart(2, "0")}`;
const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);
const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dir = path.join(process.cwd(), "billing_exports", periodKey);
  fs.mkdirSync(dir, { recursive: true });

  // Everything for the month, already split across the sites that earned it.
  const all = await loadConsolidatedBilling(year, month, null);
  if (all.bills.length === 0) {
    console.log(`No bills for ${periodKey}.`);
    await prisma.$disconnect();
    return;
  }

  // Group the exploded rows by the site each portion belongs to.
  const sites = new Map<string, { code: string; name: string }>();
  for (const b of all.bills) {
    const code = b.projectCode || "UNASSIGNED";
    if (!sites.has(code)) sites.set(code, { code, name: b.projectName || "Unassigned" });
  }

  const wanted = [...sites.values()]
    .filter((s) => onlyCodes.length === 0 || onlyCodes.includes(s.code))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`\n════ ${monthName} ${year} — consolidated bill PDFs ════`);
  console.log(`  ${all.sourceBillCount} vehicles billed across ${sites.size} sites`);
  console.log(`  ${all.splitBillCount} worked more than one site and appear under each\n`);
  console.log(`  ${pad("Site", 26)}${pad("Code", 14)}${padL("rows", 5)}${padL("value", 18)}   file`);

  let total = 0;
  for (const s of wanted) {
    const one = await loadConsolidatedBilling(year, month, s.code);
    if (one.bills.length === 0) continue;
    one.bills.sort((a, b) => b.grandTotalCents - a.grandTotalCents);
    const grand = one.bills.reduce((n, b) => n + b.grandTotalCents, 0);
    total += grand;

    const file = `${safe(s.code)}_${monthName}${year}.pdf`;
    const buf = await renderToBuffer(
      <ConsolidatedDocument
        bills={one.bills}
        periodKey={periodKey}
        generatedAt={generatedAt}
        statements={one.statements}
        stmtTotals={one.stmtTotals}
      />
    );
    fs.writeFileSync(path.join(dir, file), buf);
    console.log(`  ${pad(s.name.slice(0, 25), 26)}${pad(s.code, 14)}${padL(one.bills.length, 5)}${padL(rs(grand), 18)}   ${file}`);
  }

  // The all-sites copy, only when nothing was filtered out — a partial "ALL"
  // would be a lie about what the month contains.
  if (onlyCodes.length === 0) {
    all.bills.sort(
      (a, b) => (a.projectName || "").localeCompare(b.projectName || "") || b.grandTotalCents - a.grandTotalCents
    );
    const file = `ALL-SITES_${monthName}${year}.pdf`;
    const buf = await renderToBuffer(
      <ConsolidatedDocument
        bills={all.bills}
        periodKey={periodKey}
        generatedAt={generatedAt}
        statements={all.statements}
        stmtTotals={all.stmtTotals}
      />
    );
    fs.writeFileSync(path.join(dir, file), buf);
    const allGrand = all.bills.reduce((n, b) => n + b.grandTotalCents, 0);
    console.log(`  ${pad("ALL SITES", 26)}${pad("", 14)}${padL(all.bills.length, 5)}${padL(rs(allGrand), 18)}   ${file}`);
    // Per-site files are portions of one month; they must sum to it exactly.
    console.log(`\n  per-site total ${rs(total)}   all-sites total ${rs(allGrand)}   ${total === allGrand ? "✓ reconciles" : "✗ MISMATCH"}`);
  }

  console.log(`\n  written to ${dir}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
