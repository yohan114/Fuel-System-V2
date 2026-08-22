/**
 * The one-page SITE SUMMARY BILL, for every site, for one or more months.
 *
 * Same document as scripts/site_summary_bill.ts renders for a single site — the
 * sheet a site manager is asked to agree to — but swept across the whole estate
 * so a month can be handed out in one go.
 *
 * A site is included when it held a machine or ran a pump in the month, taken
 * from the postings and the fuel rather than from the bills: this page counts
 * what the SITE can point at in its own register, which is not the same set as
 * the machines whose monthly invoice happens to be addressed here.
 *
 * A machine earns a line only where it drew fuel from this site's own pumps —
 * the same precondition the monthly bill applies. Anything posted here that did
 * not is named at the foot of the page rather than charged.
 *
 * Named the way the owner's folders are — sitesummary_CEP03F_202607.pdf.
 *
 *   npx tsx scripts/export-site-summaries.ts 2026 6 7
 *   npx tsx scripts/export-site-summaries.ts 2026 7 --only=CEP-03F,KARA
 */
import { prisma } from "../src/lib/db";
import { buildSiteSummary } from "../src/lib/billing/site-summary";
import { renderSiteSummaryPdf } from "../src/lib/billing/site-summary-document";
import * as fs from "fs";
import * as path from "path";

const argv = process.argv.slice(2);
const year = parseInt(argv[0] || "2026", 10);
const months = argv.slice(1).filter((a) => !a.startsWith("--")).map((m) => parseInt(m, 10));
const only = (argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (months.length === 0) {
  console.error("usage: npx tsx scripts/export-site-summaries.ts <year> <month> [month...] [--only=CODE,CODE]");
  process.exit(1);
}

const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (x: number) => x.toLocaleString("en-LK", { maximumFractionDigits: 1 });
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);
// The owner's own filenames carry no punctuation: CEP-03F 2026-07 → CEP03F_202607.
const flat = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");

async function sitesFor(year: number, month: number): Promise<{ id: string; code: string; name: string }[]> {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  const start = new Date(`${year}-${mm}-01T00:00:00+05:30`);
  const end = new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999+05:30`);

  const [posted, fuelled] = await Promise.all([
    prisma.assetAssignment.findMany({
      where: { startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }] },
      select: { projectId: true }, distinct: ["projectId"],
    }),
    prisma.fuelIssue.findMany({
      where: { voided: false, issueDate: { gte: start, lte: end }, bulkTankId: { not: null } },
      select: { bulkTank: { select: { projectId: true } } },
    }),
  ]);

  const ids = new Set<string>([
    ...posted.map((p) => p.projectId),
    ...fuelled.map((f) => f.bulkTank?.projectId).filter((x): x is string => !!x),
  ]);

  const projects = await prisma.project.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
  return only.length ? projects.filter((p) => only.includes(p.code)) : projects;
}

async function main() {
  for (const month of months) {
    const mm = String(month).padStart(2, "0");
    const periodKey = `${year}-${mm}`;
    const dir = path.join(process.cwd(), "billing_exports", periodKey, "site-summaries");
    fs.mkdirSync(dir, { recursive: true });

    const sites = await sitesFor(year, month);
    console.log(`\n════ ${periodKey} — site summary bills ════`);
    console.log(`  ${pad("Site", 26)}${pad("Code", 13)}${padL("mach", 5)}${padL("rental", 17)}${padL("fuel L", 10)}${padL("site total", 18)}   file`);

    let grand = 0, written = 0;
    const empty: string[] = [];

    for (const site of sites) {
      const sum = await buildSiteSummary(site.code, year, month);
      // A site with nothing posted and no fuel has nothing to agree to; saying
      // so beats handing someone a page of zeroes.
      if (sum.lines.length === 0 && sum.fuelLitres === 0) { empty.push(site.code); continue; }

      const file = `sitesummary_${flat(sum.siteCode)}_${flat(sum.periodKey)}.pdf`;
      fs.writeFileSync(path.join(dir, file), await renderSiteSummaryPdf(sum));
      grand += sum.grandTotalCents;
      written++;

      console.log(
        `  ${pad(site.name.slice(0, 25), 26)}${pad(sum.siteCode, 13)}${padL(sum.lines.length, 5)}` +
          `${padL(rs(sum.rentalCents), 17)}${padL(n1(sum.fuelLitres), 10)}${padL(rs(sum.grandTotalCents), 18)}   ${file}`,
      );
      if (sum.unrated.length) console.log(`  ${" ".repeat(26)}no rate card: ${sum.unrated.join(", ")}`);
      if (sum.billedDirect.length) console.log(`  ${" ".repeat(26)}settled direct: ${sum.billedDirect.join(", ")}`);
      if (sum.noFuelHere.length) console.log(`  ${" ".repeat(26)}posted here, no fuel from this pump (${sum.noFuelHere.length}): ${sum.noFuelHere.join(", ")}`);
    }

    console.log(`\n  ${written} site summaries · ${rs(grand)}`);
    if (empty.length) console.log(`  nothing posted and no fuel: ${empty.join(", ")}`);
    console.log(`  written to ${dir}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
