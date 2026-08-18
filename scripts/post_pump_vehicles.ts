import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Post the vehicles a pump fuelled to that pump's site, for the days it fuelled
// them.
//
// The fuel issue log answers "which site does this fuel belong to" from the
// vehicle's POSTING, not from the pump it was drawn out of — deliberately, since
// a Marawila tipper filling up at the workshop is still Marawila's fuel. The
// consequence is that importing a site's register is only half the job: the
// litres land on the right pump and the log still files them under wherever each
// machine was last posted, which for an imported register is usually a span that
// expired at the end of the previous month.
//
// This closes that gap. For every vehicle that drew from the given site's pump
// inside the window, it records a posting to that site running from its first
// draw to its last. The span is CLOSED, not open-ended: the register is evidence
// the machine was there on those days and none at all about the days after, and
// an open span would quietly claim its future fuel from every other site.
//
// Postings are compared on the Colombo calendar day, and assignedSiteOn takes
// the covering span with the LATEST start, so a new span wins over an older
// open-ended one for exactly the days it covers and no more.
//
//   npx tsx scripts/post_pump_vehicles.ts --site=CEP-03E --from=2026-08-01 --to=2026-08-06
//   npx tsx scripts/post_pump_vehicles.ts --site=CEP-03E --from=2026-08-01 --to=2026-08-06 --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const SITE = arg("site");
const FROM = arg("from");
const TO = arg("to");

const colombo = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function main() {
  if (!SITE || !FROM || !TO) throw new Error("need --site=CODE --from=YYYY-MM-DD --to=YYYY-MM-DD");
  console.log(`\n=== post ${SITE}'s pump vehicles, ${FROM} to ${TO} (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();

  const project = await prisma.project.findUnique({ where: { code: SITE } });
  if (!project) throw new Error(`site ${SITE} not found`);
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error(`${SITE} has no pump`);
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!admin) throw new Error("no ADMIN user");

  const rows = await prisma.fuelIssue.findMany({
    where: {
      bulkTankId: tank.id, voided: false,
      issueDate: { gte: colombo(FROM), lt: new Date(colombo(TO).getTime() + 86400000) },
    },
    include: { asset: { select: { id: true, code: true, regNo: true, projectId: true } } },
    orderBy: { issueDate: "asc" },
  });
  console.log(`  ${rows.length} issue(s) on "${tank.name}" in that window\n`);

  // A single first-to-last span is only safe over a short window. Across ten
  // months a machine leaves and comes back, and one span from its first draw to
  // its last would claim every refuel it made at every other site in between.
  // So each machine gets a span per VISIT: a run of draw-days broken wherever it
  // drew at a different pump.
  //
  // A day with draws at both pumps counts as a visit day here, because the rows
  // on this pump need covering. Those days are the genuinely ambiguous ones and
  // are listed separately below.
  const ids = [...new Set(rows.map((r) => r.asset.id))];
  const everything = await prisma.fuelIssue.findMany({
    where: {
      assetId: { in: ids }, voided: false,
      issueDate: { gte: colombo(FROM), lt: new Date(colombo(TO).getTime() + 86400000) },
    },
    select: { assetId: true, issueDate: true, litres: true, bulkTankId: true },
  });

  type Visit = { code: string; first: string; last: string; n: number; litres: number; pinned: string | null };
  const visits = new Map<string, Visit[]>();
  const meta = new Map<string, { code: string; pinned: string | null }>();
  for (const r of rows) meta.set(r.asset.id, { code: r.asset.code, pinned: r.asset.projectId });

  for (const assetId of ids) {
    const days = new Map<string, { here: number; litres: number; away: number }>();
    for (const e of everything.filter((x) => x.assetId === assetId)) {
      const d = dayOf(e.issueDate);
      const slot = days.get(d) ?? { here: 0, litres: 0, away: 0 };
      if (e.bulkTankId === tank.id) { slot.here++; slot.litres += e.litres; } else slot.away++;
      days.set(d, slot);
    }
    const ordered = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const out: Visit[] = [];
    let cur: Visit | null = null;
    for (const [d, slot] of ordered) {
      if (slot.here > 0) {
        if (!cur) cur = { code: meta.get(assetId)!.code, first: d, last: d, n: slot.here, litres: slot.litres, pinned: meta.get(assetId)!.pinned };
        else { cur.last = d; cur.n += slot.here; cur.litres += slot.litres; }
      } else if (cur) { out.push(cur); cur = null; }   // drew elsewhere — the visit ended
    }
    if (cur) out.push(cur);
    visits.set(assetId, out);
  }

  const codeOf = new Map((await prisma.project.findMany({ select: { id: true, code: true } })).map((p) => [p.id, p.code]));
  let created = 0, covered = 0;

  const ordered = [...visits].sort((a, b) => (meta.get(a[0])!.code).localeCompare(meta.get(b[0])!.code));
  for (const [assetId, runs] of ordered) {
    const existing = await prisma.assetAssignment.findMany({
      where: { assetId, projectId: project.id },
      select: { id: true, startDate: true, endDate: true },
    });
    for (const s of runs) {
      const already = existing.some((a) =>
        dayOf(a.startDate) <= s.first && (a.endDate === null || dayOf(a.endDate) >= s.last));
      const where = s.pinned ? codeOf.get(s.pinned) ?? "—" : "—";

      if (already) {
        covered++;
        console.log(`  ${s.code.padEnd(9)} ${String(s.n).padStart(3)} draws ${String(s.litres).padStart(5)} L  ${s.first}..${s.last}   already posted to ${SITE}`);
        continue;
      }
      created++;
      console.log(`  ${s.code.padEnd(9)} ${String(s.n).padStart(3)} draws ${String(s.litres).padStart(5)} L  ${s.first}..${s.last}   post to ${SITE}` +
        `${where !== SITE ? `   (pinned to ${where} — pin left alone)` : ""}`);

      if (APPLY) await prisma.assetAssignment.create({ data: {
        assetId, projectId: project.id,
        startDate: colombo(s.first), endDate: colombo(s.last),
        note: `Drew from ${tank.name} ${s.first} to ${s.last}`,
        createdById: admin.id,
      }});
    }
  }

  // A new span can pull in a row from ANOTHER pump that falls on the same days —
  // the same machine fuelling at two sites in one window. Those are the rows
  // whose site label changes without their pump changing, so they are named.
  const elsewhere = await prisma.fuelIssue.findMany({
    where: {
      assetId: { in: ids }, voided: false, bulkTankId: { not: tank.id },
      issueDate: { gte: colombo(FROM), lt: new Date(colombo(TO).getTime() + 86400000) },
    },
    include: { asset: { select: { id: true, code: true } }, bulkTank: { select: { project: { select: { code: true } } } } },
  });
  // With visit-level spans the only rows still caught are ones on a day the
  // machine drew here too — a real ambiguity rather than an artefact of the span.
  const affected = elsewhere.filter((r) => {
    const d = dayOf(r.issueDate);
    return (visits.get(r.asset.id) ?? []).some((s) => d >= s.first && d <= s.last);
  });
  if (affected.length) {
    console.log(`\n  ! ${affected.length} row(s) on OTHER pumps fall inside these spans and will now read ${SITE}:`);
    for (const r of affected) {
      console.log(`      ${dayOf(r.issueDate)}  ${r.asset.code.padEnd(9)} ${String(r.litres).padStart(4)} L  drawn at ${r.bulkTank?.project?.code}  "${r.source}"`);
    }
    console.log(`    Check these: the same machine on the same day at two pumps is usually`);
    console.log(`    one refuel written into two books.`);
  }

  console.log(`\n  ${created} posting(s) ${APPLY ? "created" : "to create"}, ${covered} already in place`);
  console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
}

main().finally(() => prisma.$disconnect());
