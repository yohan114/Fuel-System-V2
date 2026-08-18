import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Remove a posting that nothing supports.
//
// A machine posted to two sites for the same days is billed by whichever
// posting the resolver happens to prefer — the latest start, then the newest
// record. When one of the two has no fuel behind it at all, that preference is
// the only thing keeping the bill on the right site, and it is not a fact about
// the machine. LB-21 and MG-07 were each posted to CEP-03 Wadakada for all of
// July having drawn nothing there; Galagedara won on creation order, which is
// luck rather than evidence.
//
// Refuses to remove a posting the machine actually drew fuel against. A span
// with litres behind it is a record of where the machine was, and deleting it
// moves real money to another site — that is a merge decision, not a cleanup.
//
//   npx tsx scripts/remove_posting.ts --site=CEP-03W --code=LB-21 --from=2026-07-01
//   npx tsx scripts/remove_posting.ts --site=CEP-03W --code=LB-21 --from=2026-07-01 --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const CODE = arg("code");
const FROM = arg("from");

const dayOf = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }) : "OPEN");

async function main() {
  if (!SITE || !CODE || !FROM) throw new Error("need --site=CODE --code=MACHINE --from=YYYY-MM-DD");
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  console.log(`\n=== remove a posting (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  database: ${path.resolve(process.cwd(), url.replace(/^file:/, ""))}\n`);

  const asset = await prisma.asset.findFirst({ where: { code: CODE }, select: { id: true, code: true, regNo: true } });
  if (!asset) throw new Error(`no machine called "${CODE}"`);
  const project = await prisma.project.findUnique({ where: { code: SITE }, select: { id: true, code: true, name: true } });
  if (!project) throw new Error(`site ${SITE} not found`);

  // Matched on the Colombo DAY, not an instant. A posting's start is stored at
  // whatever time the tool that wrote it used, and asking for equality against a
  // reconstructed midnight fails on anything written a few hours either side.
  const start = new Date(`${FROM}T00:00:00+05:30`);
  const nextDay = new Date(start.getTime() + 86_400_000);
  const posting = await prisma.assetAssignment.findFirst({
    where: { assetId: asset.id, projectId: project.id, startDate: { gte: start, lt: nextDay } } });
  if (!posting) {
    const others = await prisma.assetAssignment.findMany({
      where: { assetId: asset.id, projectId: project.id }, select: { startDate: true, endDate: true } });
    throw new Error(`${asset.code} has no posting to ${SITE} starting ${FROM}.` +
      (others.length ? `\n  It has: ${others.map((o) => `${dayOf(o.startDate)}..${dayOf(o.endDate)}`).join(", ")}` : ""));
  }

  const tanks = await prisma.bulkTank.findMany({ where: { projectId: project.id }, select: { id: true } });
  const end = posting.endDate ?? new Date("2100-01-01");
  const fuel = await prisma.fuelIssue.findMany({
    where: { assetId: asset.id, voided: false, bulkTankId: { in: tanks.map((t) => t.id) },
      issueDate: { gte: posting.startDate, lte: end } },
    select: { litres: true, issueDate: true } });

  console.log(`  ${asset.code}${asset.regNo ? ` (${asset.regNo})` : ""} posted to ${project.name}`);
  console.log(`  ${dayOf(posting.startDate)} .. ${dayOf(posting.endDate)}`);
  console.log(`  fuel drawn from ${SITE}'s pump in that window: ${fuel.length} issue(s), ${fuel.reduce((n, f) => n + f.litres, 0)} L`);

  if (fuel.length) {
    console.log(`\n  REFUSED — this posting has fuel behind it, so it is a record of where`);
    console.log(`  the machine was. Removing it moves that fuel's rental to another site.\n`);
    throw new Error("posting has fuel evidence");
  }

  console.log(`  nothing was drawn here — the posting rests on no evidence`);
  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }
  await prisma.assetAssignment.delete({ where: { id: posting.id } });
  console.log(`\nDone. Removed.\n`);
}

main().finally(() => prisma.$disconnect());
