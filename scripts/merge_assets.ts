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
// --all-certain does every PLATE-AS-CODE pair in one pass: a machine whose CODE
// is another machine's registration number. That one is not a guess — a plate
// belongs to a vehicle, so a "machine" named after one is that vehicle written a
// second way. It is the only class merged in bulk; everything softer stays
// one-at-a-time and by hand.
//
//   npx tsx scripts/merge_assets.ts --from="LL-0920" --into="DT-02"
//   npx tsx scripts/merge_assets.ts --from="LL-0920" --into="DT-02" --apply
//   npx tsx scripts/merge_assets.ts --all-certain
//   npx tsx scripts/merge_assets.ts --all-certain --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ALL_CERTAIN = process.argv.includes("--all-certain");
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

type Machine = Awaited<ReturnType<typeof find>>;

async function mergeOne(from: Machine, into: Machine, quiet = false) {
  const say = (...x: unknown[]) => { if (!quiet) console.log(...x); };
  if (from.id === into.id) throw new Error("--from and --into are the same machine");

  const cf = await census(from.id), ci = await census(into.id);
  say(`\n  FROM (deleted)  ${from.code}  plate=${from.regNo ?? "—"}  ${from.category?.name} @ ${from.project?.code ?? "—"}  meter ${from.meterType}`);
  say(`      ${show(cf)}`);
  say(`  INTO (survives) ${into.code}  plate=${into.regNo ?? "—"}  ${into.category?.name} @ ${into.project?.code ?? "—"}  meter ${into.meterType}`);
  say(`      ${show(ci)}`);

  if (from.meterType !== into.meterType) {
    say(`\n  ! meters differ (${from.meterType} vs ${into.meterType}). ${from.code}'s ${cf.readings} reading(s)`);
    say(`    would join a ${into.meterType} series. Check these are one machine before applying.`);
  }
  if (from.category?.name !== into.category?.name) {
    say(`\n  ! categories differ (${from.category?.name} vs ${into.category?.name}).`);
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
    say(`\n  ${clashes.length} day(s) where BOTH already have fuel — check these are not one refuel twice:`);
    for (const r of clashes.slice(0, 12)) {
      const d = dayOf(r.issueDate);
      say(`      ${d}  ${from.code} ${r.litres} L "${r.source}"   |   ${into.code} ${iByDay.get(d)!.map((x) => `${x.litres} L "${x.source}"`).join(" ; ")}`);
    }
    if (clashes.length > 12) say(`      … and ${clashes.length - 12} more`);
  }

  // The uniqueness rules that a blind move would break.
  const fCond = await prisma.dailyCondition.findMany({ where: { assetId: from.id }, select: { id: true, logDate: true } });
  const iCondDays = new Set((await prisma.dailyCondition.findMany({ where: { assetId: into.id }, select: { logDate: true } })).map((c) => dayOf(c.logDate)));
  const condClash = fCond.filter((c) => iCondDays.has(dayOf(c.logDate)));
  if (condClash.length) say(`\n  ${condClash.length} condition log(s) fall on days ${into.code} already logged — the survivor's are kept, these dropped`);
  if (cf.rate && ci.rate) say(`  both carry a rental rate — ${into.code}'s is kept, ${from.code}'s dropped`);
  if (cf.interval && ci.interval) say(`  both carry a service interval — ${into.code}'s is kept, ${from.code}'s dropped`);

  say(`\n  after the merge, ${into.code} holds:`);
  say(`      ${cf.issues + ci.issues} issues (${Math.round(cf.litres + ci.litres).toLocaleString()} L) · ${cf.readings + ci.readings} readings · ` +
    `${cf.assignments + ci.assignments} postings · ${cf.bills + ci.bills} bills`);
  say(`      "${from.code}" is deleted`);

  if (!APPLY) { say(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }

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

  say(`\n  folded "${from.code}" into "${into.code}"`);
  return { issues: cf.issues, litres: cf.litres, readings: cf.readings };
}

// A machine whose CODE is another's registration number. Certain by definition —
// but only when the plate has exactly ONE owner. 68-5115 is carried by both BS-03
// and DB-02, and merging into either would be a coin toss, so those are skipped
// and named.
async function certainPairs() {
  const all = await prisma.asset.findMany({
    select: { id: true, code: true, regNo: true, meterType: true, projectId: true,
      category: { select: { name: true } }, project: { select: { code: true } } } });
  const owners = new Map<string, typeof all>();
  for (const a of all) {
    if (!a.regNo) continue;
    const k = alnum(a.regNo);
    (owners.get(k) ?? owners.set(k, []).get(k)!).push(a);
  }
  const pairs: { from: Machine; into: Machine }[] = [];
  const skipped: string[] = [];
  for (const a of all) {
    const holders = (owners.get(alnum(a.code)) ?? []).filter((o) => o.id !== a.id);
    if (!holders.length) continue;
    if (holders.length > 1) {
      skipped.push(`${a.code} — that plate is carried by ${holders.length} machines (${holders.map((h) => h.code).join(", ")}); merge it by hand`);
      continue;
    }
    pairs.push({ from: a, into: holders[0] });
  }
  return { pairs, skipped };
}

async function main() {
  if (ALL_CERTAIN) {
    console.log(`\n=== merge every machine filed under its own plate (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
    announceDatabase();
    const { pairs, skipped } = await certainPairs();
    console.log(`\n  ${pairs.length} certain pair(s)${skipped.length ? `, ${skipped.length} skipped` : ""}\n`);

    let issues = 0, litres = 0, readings = 0, done = 0;
    for (const { from, into } of pairs) {
      // The fleet shifts as we go — an earlier merge may already have taken this
      // one — so each pair is re-read rather than trusted from the first pass.
      const live = await prisma.asset.findUnique({ where: { id: from.id }, select: { id: true } });
      const target = await prisma.asset.findUnique({ where: { id: into.id }, select: { id: true } });
      if (!live || !target) { console.log(`  ${from.code} -> ${into.code}  already merged, skipping`); continue; }

      const c = await census(from.id);
      console.log(`  ${from.code.padEnd(14)} -> ${into.code.padEnd(10)} ${String(c.issues).padStart(4)} issues ${Math.round(c.litres).toLocaleString().padStart(7)} L · ${c.readings} readings · ${c.assignments} postings · ${c.bills} bills`);
      issues += c.issues; litres += c.litres; readings += c.readings; done++;
      if (APPLY) await mergeOne(from, into, true);
    }
    if (skipped.length) {
      console.log(`\n  SKIPPED — not certain enough for a batch:`);
      for (const s of skipped) console.log(`      ${s}`);
    }
    console.log(`\n  ${done} machine(s) ${APPLY ? "folded away" : "would be folded away"}`);
    console.log(`  ${issues} fuel issues (${Math.round(litres).toLocaleString()} L), ${readings} meter readings move onto the surviving machines`);
    console.log(`  no fuel is deleted — every row keeps its date, litres and pump, and simply changes machine`);
    console.log(APPLY ? `\nDone.\n` : `\nDRY-RUN — nothing written. Re-run with --apply\n`);
    return;
  }

  if (!FROM || !INTO) throw new Error('need --from="loser" --into="keeper", or --all-certain');
  console.log(`\n=== merge machines (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();
  const from = await find(FROM);
  const into = await find(INTO);
  await mergeOne(from, into);
  if (APPLY) console.log("");
}

main().finally(() => prisma.$disconnect());
