import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Fold one machine into another.
//
// The same excavator is DT-02 in the workshop register and LL-0920 on the site's
// daily sheet. An importer that could not match the plate registered it as a
// machine in its own right, and the fleet now carries one machine as two: its
// fuel splits between them, its meter chain breaks in the middle, and neither
// record shows what it really cost to run.
//
// Twelve tables point at an asset and all twelve move. Three carry a uniqueness
// rule that a blind move would break:
//   DailyCondition   unique on (asset, day) — a day both machines logged
//   RentalRate       one per asset
//   ServiceInterval  one per asset
// In each case the survivor's row is kept and the loser's is reported, never
// silently dropped.
//
// Fuel issues are NOT deduplicated. Two rows for the same machine on the same day
// are usually two genuine fills, and this tool cannot tell those from one refuel
// written into two books — that judgement needs the source sheets. Same-day
// overlaps are listed instead so they can be checked afterwards.
//
//   npx tsx scripts/merge_assets.ts --from="LL-0920" --into="DT-02"
//   npx tsx scripts/merge_assets.ts --from="LL-0920" --into="DT-02" --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FROM = arg("from");
const INTO = arg("into");

const alnum = (s: string | null) => String(s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
}

async function find(needle: string) {
  const all = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true, projectId: true,
      category: { select: { name: true } }, project: { select: { code: true } } } });
  const exact = all.filter((a) => a.id === needle || alnum(a.code) === alnum(needle));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new Error(`"${needle}" matches ${exact.length} machines by code`);
  const byPlate = all.filter((a) => alnum(a.regNo) === alnum(needle));
  if (byPlate.length === 1) return byPlate[0];
  throw new Error(byPlate.length ? `"${needle}" is the plate of ${byPlate.length} machines` : `no machine matches "${needle}"`);
}

async function census(id: string) {
  const [issues, litres, readings, assignments, allocations, requests, corrections,
         conditions, bills, services, filters, rate, interval] = await Promise.all([
    prisma.fuelIssue.count({ where: { assetId: id } }),
    prisma.fuelIssue.aggregate({ where: { assetId: id, voided: false }, _sum: { litres: true } }),
    prisma.meterReading.count({ where: { assetId: id } }),
    prisma.assetAssignment.count({ where: { assetId: id } }),
    prisma.vehicleAllocation.count({ where: { assetId: id } }),
    prisma.fuelRequest.count({ where: { assetId: id } }),
    prisma.fuelIssueCorrection.count({ where: { assetId: id } }),
    prisma.dailyCondition.count({ where: { assetId: id } }),
    prisma.bill.count({ where: { assetId: id } }),
    prisma.serviceRecord.count({ where: { assetId: id } }),
    prisma.assetFilter.count({ where: { assetId: id } }),
    prisma.rentalRate.count({ where: { assetId: id } }),
    prisma.serviceInterval.count({ where: { assetId: id } }),
  ]);
  return { issues, litres: litres._sum.litres ?? 0, readings, assignments, allocations, requests,
    corrections, conditions, bills, services, filters, rate, interval };
}

const show = (c: Awaited<ReturnType<typeof census>>) =>
  `${c.issues} issues (${Math.round(c.litres).toLocaleString()} L) · ${c.readings} readings · ${c.assignments} postings · ` +
  `${c.allocations} allocations · ${c.bills} bills · ${c.services} services · ${c.conditions} condition logs · ` +
  `${c.filters} filters${c.rate ? " · has a rental rate" : ""}${c.interval ? " · has a service interval" : ""}`;

async function main() {
  if (!FROM || !INTO) throw new Error('need --from="loser" --into="keeper"');
  console.log(`\n=== merge machines (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();

  const from = await find(FROM);
  const into = await find(INTO);
  if (from.id === into.id) throw new Error("--from and --into are the same machine");

  const cf = await census(from.id), ci = await census(into.id);
  console.log(`\n  FROM (deleted)  ${from.code}  plate=${from.regNo ?? "—"}  ${from.category?.name} @ ${from.project?.code ?? "—"}  meter ${from.meterType}`);
  console.log(`      ${show(cf)}`);
  console.log(`  INTO (survives) ${into.code}  plate=${into.regNo ?? "—"}  ${into.category?.name} @ ${into.project?.code ?? "—"}  meter ${into.meterType}`);
  console.log(`      ${show(ci)}`);

  if (from.meterType !== into.meterType) {
    console.log(`\n  ! meters differ (${from.meterType} vs ${into.meterType}). ${from.code}'s ${cf.readings} reading(s)`);
    console.log(`    would join a ${into.meterType} series. Check these are one machine before applying.`);
  }
  if (from.category?.name !== into.category?.name) {
    console.log(`\n  ! categories differ (${from.category?.name} vs ${into.category?.name}).`);
  }

  // Two rows for one machine on one day are usually two genuine fills, but they
  // are also what one refuel written into two books looks like. Named, not
  // touched — telling them apart needs the source sheets.
  const [fIssues, iIssues] = await Promise.all([
    prisma.fuelIssue.findMany({ where: { assetId: from.id, voided: false }, select: { issueDate: true, litres: true, source: true } }),
    prisma.fuelIssue.findMany({ where: { assetId: into.id, voided: false }, select: { issueDate: true, litres: true, source: true } }),
  ]);
  const iByDay = new Map<string, typeof iIssues>();
  for (const r of iIssues) {
    const d = dayOf(r.issueDate);
    (iByDay.get(d) ?? iByDay.set(d, []).get(d)!).push(r);
  }
  const clashes = fIssues.filter((r) => iByDay.has(dayOf(r.issueDate)));
  if (clashes.length) {
    console.log(`\n  ${clashes.length} day(s) where BOTH already have fuel — check these are not one refuel twice:`);
    for (const r of clashes.slice(0, 12)) {
      const d = dayOf(r.issueDate);
      console.log(`      ${d}  ${from.code} ${r.litres} L "${r.source}"   |   ${into.code} ${iByDay.get(d)!.map((x) => `${x.litres} L "${x.source}"`).join(" ; ")}`);
    }
    if (clashes.length > 12) console.log(`      … and ${clashes.length - 12} more`);
  }

  // The uniqueness rules that a blind move would break.
  const fCond = await prisma.dailyCondition.findMany({ where: { assetId: from.id }, select: { id: true, logDate: true } });
  const iCondDays = new Set((await prisma.dailyCondition.findMany({ where: { assetId: into.id }, select: { logDate: true } })).map((c) => dayOf(c.logDate)));
  const condClash = fCond.filter((c) => iCondDays.has(dayOf(c.logDate)));
  if (condClash.length) console.log(`\n  ${condClash.length} condition log(s) fall on days ${into.code} already logged — the survivor's are kept, these dropped`);
  if (cf.rate && ci.rate) console.log(`  both carry a rental rate — ${into.code}'s is kept, ${from.code}'s dropped`);
  if (cf.interval && ci.interval) console.log(`  both carry a service interval — ${into.code}'s is kept, ${from.code}'s dropped`);

  console.log(`\n  after the merge, ${into.code} holds:`);
  console.log(`      ${cf.issues + ci.issues} issues (${Math.round(cf.litres + ci.litres).toLocaleString()} L) · ${cf.readings + ci.readings} readings · ` +
    `${cf.assignments + ci.assignments} postings · ${cf.bills + ci.bills} bills`);
  console.log(`      "${from.code}" is deleted`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }

  await prisma.$transaction(async (tx) => {
    if (condClash.length) await tx.dailyCondition.deleteMany({ where: { id: { in: condClash.map((c) => c.id) } } });
    if (cf.rate && ci.rate) await tx.rentalRate.deleteMany({ where: { assetId: from.id } });
    if (cf.interval && ci.interval) await tx.serviceInterval.deleteMany({ where: { assetId: from.id } });

    await tx.fuelIssue.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.meterReading.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.assetAssignment.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.vehicleAllocation.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.fuelRequest.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.fuelIssueCorrection.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.dailyCondition.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.bill.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.serviceRecord.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.assetFilter.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.rentalRate.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });
    await tx.serviceInterval.updateMany({ where: { assetId: from.id }, data: { assetId: into.id } });

    // The plate the loser was carrying is worth keeping when the survivor has
    // none — it is often the only place the registration is recorded.
    if (!into.regNo && from.regNo) await tx.asset.update({ where: { id: into.id }, data: { regNo: from.regNo } });
    await tx.asset.delete({ where: { id: from.id } });
  });

  console.log(`\nDone. "${from.code}" folded into "${into.code}".\n`);
}

main().finally(() => prisma.$disconnect());
