import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Machines posted to two sites on the same day.
//
// A posting says which site a vehicle belonged to over a date range. It decides
// the site shown against every fuel issue and, through the billing month split,
// which site pays for it. A machine cannot be in two places, so overlapping
// postings mean the system is guessing — assignedSiteOn takes whichever span
// starts later, and when both start on the 1st of a month that is arbitrary.
//
// They come from the register imports. Each site's register listed the machines
// it saw that month and each import created a whole-month posting at its own
// site, without checking whether another site had already claimed it.
//
// This tool only REPORTS. Resolving an overlap means deciding which site a
// machine really worked for, which moves money between sites' bills, and the
// evidence for that is the fuel: the pump that actually issued it is where it
// was. The last section lays that evidence out per machine-month so the call can
// be made on numbers.
//
//   npx tsx scripts/find_overlapping_postings.ts
//   npx tsx scripts/find_overlapping_postings.ts --asset=AP-08

const ONLY = process.argv.find((a) => a.startsWith("--asset="))?.slice(8);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const OPEN = "9999-99-99";

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function main() {
  console.log(`\n=== machines posted to two sites at once ===`);
  announceDatabase();

  const asg = await prisma.assetAssignment.findMany({
    where: ONLY ? { asset: { code: ONLY } } : {},
    select: { id: true, assetId: true, projectId: true, startDate: true, endDate: true, note: true,
      asset: { select: { code: true } } } });
  const codeOf = new Map((await prisma.project.findMany({ select: { id: true, code: true } })).map((p) => [p.id, p.code]));

  // A whole calendar month is the register imports' signature; a book with real
  // dates produces anything else.
  const isWholeMonth = (a: typeof asg[number]) => {
    if (!a.endDate) return false;
    const s = dayOf(a.startDate), e = dayOf(a.endDate);
    const last = new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0).getDate();
    return s.endsWith("-01") && e === `${s.slice(0, 8)}${String(last).padStart(2, "0")}`;
  };
  console.log(`  ${asg.length} postings · ${asg.filter(isWholeMonth).length} whole calendar months · ${asg.filter((a) => !a.endDate).length} open-ended\n`);

  const byAsset = new Map<string, typeof asg>();
  for (const a of asg) (byAsset.get(a.assetId) ?? byAsset.set(a.assetId, []).get(a.assetId)!).push(a);

  const span = (a: typeof asg[number]) => [dayOf(a.startDate), a.endDate ? dayOf(a.endDate) : OPEN] as const;
  const rows: { code: string; assetId: string; n: number; detail: string[] }[] = [];
  let monthlyPairs = 0, bothMonthly = 0, total = 0;

  for (const [assetId, list] of byAsset) {
    const detail: string[] = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].projectId === list[j].projectId) continue;
      const [aS, aE] = span(list[i]), [bS, bE] = span(list[j]);
      if (aS > bE || bS > aE) continue;
      total++;
      const m1 = isWholeMonth(list[i]), m2 = isWholeMonth(list[j]);
      if (m1 || m2) monthlyPairs++;
      if (m1 && m2) bothMonthly++;
      detail.push(`${codeOf.get(list[i].projectId)} ${aS}..${aE === OPEN ? "open" : aE}   vs   ${codeOf.get(list[j].projectId)} ${bS}..${bE === OPEN ? "open" : bE}`);
    }
    if (detail.length) rows.push({ code: list[0].asset.code, assetId, n: detail.length, detail });
  }
  rows.sort((a, b) => b.n - a.n);

  console.log(`  ${rows.length} machines · ${total} overlapping pairs`);
  console.log(`  ${monthlyPairs} involve a whole-month span, ${bothMonthly} are two whole-month spans —`);
  console.log(`  that is the register imports each claiming the same machine for the same month.\n`);

  for (const r of rows.slice(0, ONLY ? rows.length : 8)) {
    console.log(`  ${r.code} — ${r.n} overlapping pairs`);
    for (const d of r.detail.slice(0, ONLY ? r.detail.length : 6)) console.log(`      ${d}`);
    if (!ONLY && r.detail.length > 6) console.log(`      … and ${r.detail.length - 6} more`);

    // The fuel says where it actually was.
    const fuel = await prisma.fuelIssue.findMany({
      where: { assetId: r.assetId, voided: false },
      select: { issueDate: true, litres: true, bulkTank: { select: { project: { select: { code: true } } } } } });
    const perMonth = new Map<string, Map<string, { n: number; l: number }>>();
    for (const f of fuel) {
      const m = dayOf(f.issueDate).slice(0, 7);
      const site = f.bulkTank?.project?.code ?? "—";
      const inner = perMonth.get(m) ?? perMonth.set(m, new Map()).get(m)!;
      const e = inner.get(site) ?? { n: 0, l: 0 };
      e.n++; e.l += f.litres;
      inner.set(site, e);
    }
    const contested = [...perMonth].filter(([, sites]) => sites.size > 1).sort();
    if (contested.length) {
      console.log(`      which pump actually fuelled it:`);
      for (const [m, sites] of contested) {
        console.log(`        ${m}  ${[...sites].sort((x, y) => y[1].l - x[1].l).map(([s, v]) => `${s} ${v.n}x ${Math.round(v.l)}L`).join("  ·  ")}`);
      }
    } else if (fuel.length) {
      const only = [...new Set(fuel.map((f) => f.bulkTank?.project?.code))];
      console.log(`      every refuel came from ${only.join(", ")} — that is where it was`);
    } else {
      console.log(`      it never drew fuel, so the fuel cannot settle this one`);
    }
    console.log("");
  }
  if (!ONLY && rows.length > 8) console.log(`  … and ${rows.length - 8} more machines. Use --asset=CODE for one in full.\n`);
}

main().finally(() => prisma.$disconnect());
