import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Set how long a machine was posted to a site, when the office knows better
// than the pump.
//
// post_pump_vehicles.ts derives a span from fuel: first draw to last. That is
// the right default when nobody can say otherwise, but it is a floor, not the
// truth — a machine sitting on site available for work draws nothing on the days
// it is idle, and a site that kept it all month is owed all month. HEX-01 last
// fuelled on 9 July and stayed to the 31st; the register cannot know that and
// the site manager can.
//
// The guard is the other sites' registers. Days being ADDED are refused if the
// machine drew from another site's pump on them — those days are already
// evidenced somewhere else, and quietly taking them would move that site's
// rental here.
//
//   npx tsx scripts/set_posting_span.ts --site=CEP-03F --codes=HEX-01,SR-13 --from=2026-07-01 --to=2026-07-31
//   npx tsx scripts/set_posting_span.ts --site=CEP-03F --codes=HEX-01,SR-13 --from=2026-07-01 --to=2026-07-31 --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const CODES = (arg("codes") || "").split(",").map((c) => c.trim()).filter(Boolean);
const FROM = arg("from");
const TO = arg("to");

const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const endOf = (d: string) => new Date(`${d}T23:59:59.999+05:30`);
const dayOf = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" }) : "OPEN");
const spanDays = (a: string, b: string) => Math.round((colombo(b).getTime() - colombo(a).getTime()) / 86_400_000) + 1;

async function main() {
  if (!SITE || !CODES.length || !FROM || !TO) throw new Error("need --site=CODE --codes=A,B --from=YYYY-MM-DD --to=YYYY-MM-DD");
  if (FROM > TO) throw new Error(`--from ${FROM} is after --to ${TO}`);
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  console.log(`\n=== set posting spans · ${SITE} · ${FROM}..${TO} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  database: ${path.resolve(process.cwd(), url.replace(/^file:/, ""))}\n`);

  const project = await prisma.project.findUnique({ where: { code: SITE }, select: { id: true, code: true, name: true } });
  if (!project) throw new Error(`site ${SITE} not found`);
  const assets = await prisma.asset.findMany({ where: { code: { in: CODES } }, select: { id: true, code: true, regNo: true } });
  const missing = CODES.filter((c) => !assets.some((a) => a.code === c));
  if (missing.length) throw new Error(`not in the fleet: ${missing.join(", ")} — nothing written`);

  const start = colombo(FROM), end = endOf(TO);
  let changed = 0;
  const refused: string[] = [];

  for (const code of CODES) {
    const a = assets.find((x) => x.code === code)!;
    const existing = await prisma.assetAssignment.findFirst({
      where: { assetId: a.id, projectId: project.id, startDate: { lte: end },
        OR: [{ endDate: null }, { endDate: { gte: start } }] },
      orderBy: { startDate: "asc" } });

    const wasFrom = existing ? dayOf(existing.startDate) : null;
    const wasTo = existing ? dayOf(existing.endDate) : null;

    // Only the days this change ADDS need checking. Days already inside the
    // posting are not in question, and days being given up cannot take anything
    // from anyone.
    const addedFrom = !existing || FROM < wasFrom! ? FROM : null;
    const addedTo = !existing || wasTo === "OPEN" ? null : TO > wasTo! ? TO : null;
    const clashes: string[] = [];
    for (const [lo, hi] of [
      addedFrom ? [FROM, wasFrom ? dayOf(new Date(colombo(wasFrom).getTime() - 86_400_000)) : TO] : null,
      addedTo ? [dayOf(new Date(colombo(wasTo!).getTime() + 86_400_000)), TO] : null,
    ].filter(Boolean) as [string, string][]) {
      if (lo > hi) continue;
      const elsewhere = await prisma.fuelIssue.findMany({
        where: { assetId: a.id, voided: false, issueDate: { gte: colombo(lo), lte: endOf(hi) },
          bulkTank: { projectId: { not: project.id } } },
        select: { issueDate: true, litres: true, bulkTank: { select: { project: { select: { code: true } } } } } });
      for (const f of elsewhere)
        clashes.push(`${dayOf(f.issueDate)} drew ${f.litres} L at ${f.bulkTank?.project?.code ?? "another site"}`);
    }

    if (clashes.length) {
      refused.push(code);
      console.log(`  ${code.padEnd(11)}REFUSED — the days being added are evidenced elsewhere:`);
      for (const c of [...new Set(clashes)]) console.log(`      ${c}`);
      continue;
    }

    if (existing && wasFrom === FROM && wasTo === TO) {
      console.log(`  ${code.padEnd(11)}${FROM}..${TO}  ${spanDays(FROM, TO)} days — already`);
      continue;
    }
    console.log(`  ${code.padEnd(11)}${existing ? `${wasFrom}..${wasTo} (${spanDays(wasFrom!, wasTo === "OPEN" ? TO : wasTo!)} days)` : "no posting"}` +
      `  ->  ${FROM}..${TO} (${spanDays(FROM, TO)} days)`);
    changed++;
    if (!APPLY) continue;
    if (existing) await prisma.assetAssignment.update({ where: { id: existing.id }, data: { startDate: start, endDate: colombo(TO) } });
    else await prisma.assetAssignment.create({ data: { assetId: a.id, projectId: project.id, startDate: start, endDate: colombo(TO) } });
  }

  console.log(`\n  ${changed} posting(s) ${APPLY ? "set" : "to set"}${refused.length ? `, ${refused.length} refused: ${refused.join(", ")}` : ""}`);
  console.log(APPLY ? `\nDone. Re-run the affected months' bills.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
