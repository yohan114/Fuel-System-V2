import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Close postings that were never given an end date.
//
// A posting with no end runs forever. The machine is billed at that site for
// every day of every month after, whether or not it is still there, and nobody
// is told — the bill simply arrives with a full month on it. A vehicle posted on
// the 6th of July still claims the whole of August, September and beyond.
//
// The register is evidence the machine was at a site on the days it drew from
// that site's pump, and evidence of nothing at all about the days after its last
// draw. So an open posting is closed on the last day the machine actually drew
// there. post_pump_vehicles.ts has always written closed spans for exactly this
// reason; these open ones came in by another route.
//
// A posting whose machine never drew at that site is left alone and reported: it
// may be a hand allocation for a machine that does not fuel from the site pump,
// and guessing an end date for it would be inventing the very thing this fixes.
//
//   npx tsx scripts/close_open_postings.ts --site=CEP-03F
//   npx tsx scripts/close_open_postings.ts --site=CEP-03F --apply
//   npx tsx scripts/close_open_postings.ts            (every site)

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);

async function main() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  console.log(`\n=== close open-ended postings${SITE ? ` · ${SITE}` : ""} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  database: ${path.resolve(process.cwd(), url.replace(/^file:/, ""))}\n`);

  const open = await prisma.assetAssignment.findMany({
    where: { endDate: null, ...(SITE ? { project: { code: SITE } } : {}) },
    include: { asset: { select: { id: true, code: true, regNo: true } },
      project: { select: { id: true, code: true, name: true } } },
    orderBy: [{ project: { code: "asc" } }, { startDate: "asc" }] });
  if (!open.length) { console.log(`  no open-ended postings.\n`); return; }

  const tanksBySite = new Map<string, string[]>();
  for (const a of open) {
    if (tanksBySite.has(a.project.id)) continue;
    const t = await prisma.bulkTank.findMany({ where: { projectId: a.project.id }, select: { id: true } });
    tanksBySite.set(a.project.id, t.map((x) => x.id));
  }

  let toClose = 0;
  const noEvidence: string[] = [];
  console.log(`  ${"site".padEnd(12)}${"machine".padEnd(11)}${"posted from".padEnd(13)}${"last drew here".padEnd(16)}what happens`);

  for (const a of open) {
    const tankIds = tanksBySite.get(a.project.id) ?? [];
    const last = tankIds.length ? await prisma.fuelIssue.findFirst({
      where: { assetId: a.asset.id, voided: false, bulkTankId: { in: tankIds }, issueDate: { gte: a.startDate } },
      orderBy: { issueDate: "desc" }, select: { issueDate: true } }) : null;

    if (!last) {
      noEvidence.push(`${a.project.code} ${a.asset.code} from ${dayOf(a.startDate)}`);
      console.log(`  ${a.project.code.padEnd(12)}${a.asset.code.padEnd(11)}${dayOf(a.startDate).padEnd(13)}${"never".padEnd(16)}left open — no evidence to close it on`);
      continue;
    }
    const end = dayOf(last.issueDate);
    const days = Math.round((colombo(end).getTime() - colombo(dayOf(a.startDate)).getTime()) / 86_400_000) + 1;
    toClose++;
    console.log(`  ${a.project.code.padEnd(12)}${a.asset.code.padEnd(11)}${dayOf(a.startDate).padEnd(13)}${end.padEnd(16)}close at ${end} (${days} day${days === 1 ? "" : "s"})`);
    if (APPLY) await prisma.assetAssignment.update({ where: { id: a.id }, data: { endDate: colombo(end) } });
  }

  console.log(`\n  ${open.length} open posting(s): ${toClose} ${APPLY ? "closed" : "to close"}, ${noEvidence.length} left open`);
  if (noEvidence.length) {
    console.log(`\n  left open — these never drew from their site's pump, so the register`);
    console.log(`  says nothing about when they left. Close them by hand if they have gone:`);
    for (const n of noEvidence) console.log(`      ${n}`);
  }
  console.log(APPLY ? `\nDone. Re-run the affected months' bills.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
