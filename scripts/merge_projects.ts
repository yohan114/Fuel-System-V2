import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Fold one project (site) into another.
//
// The companion to merge_tanks.ts, and usually needed with it. A site recorded
// twice — "CEP-03 E" beside "CEP-03E", "LOT-04" beside "IRD-04" — splits more
// than its pump: vehicles, allocations, budgets and operators all sit under
// whichever spelling was current when the row was made. Merging only the tanks
// moves the fuel and leaves a second site behind still holding the fleet.
//
// What moves:
//   Asset.projectId              vehicles pinned to the site
//   AssetAssignment.projectId    which site a vehicle was posted to, and when
//   VehicleAllocation.projectId  allocation register rows
//   BulkTank.projectId           the pump(s)
//   User.projectId               site staff
//   Budget.projectId             monthly fuel budgets
//   FuelIssueCorrection          correction requests raised on the site
//
// Bill and BillLineItem carry projectId as a SNAPSHOT with no foreign key — a
// record of where a vehicle was when the bill was raised. Those are repointed
// too, but their projectName/projectCode text is left exactly as issued: a bill
// already sent to a client must keep saying what it said.
//
// Budgets collide. Both sites can hold a budget for the same year and month, and
// the schema makes that pair unique, so a blind move fails on the constraint.
// The survivor's budget wins and the loser's is reported, not silently dropped.
//
// Assignments are deduplicated the same way: the same vehicle posted to both
// spellings of one site on the same day is one posting, not two.
//
//   npx tsx scripts/merge_projects.ts                            # list look-alike sites
//   npx tsx scripts/merge_projects.ts --from="X" --into="Y"      # dry run
//   npx tsx scripts/merge_projects.ts --from="X" --into="Y" --apply

const APPLY = process.argv.includes("--apply");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FROM = arg("from");
const INTO = arg("into");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
}

async function find(needle: string) {
  const all = await prisma.project.findMany();
  const exact = all.filter((p) => p.id === needle || norm(p.code) === norm(needle) || norm(p.name) === norm(needle));
  if (exact.length === 1) return exact[0];
  const loose = all.filter((p) => norm(p.code).includes(norm(needle)) || norm(p.name).includes(norm(needle)));
  if (loose.length === 1) return loose[0];
  if (loose.length === 0) throw new Error(`no site matches "${needle}"`);
  throw new Error(`"${needle}" matches ${loose.length} sites: ${loose.map((p) => `${p.code} (${p.name})`).join(" | ")}`);
}

async function census(id: string) {
  const [assets, assignments, allocations, tanks, users, budgets, corrections, bills] = await Promise.all([
    prisma.asset.count({ where: { projectId: id } }),
    prisma.assetAssignment.count({ where: { projectId: id } }),
    prisma.vehicleAllocation.count({ where: { projectId: id } }),
    prisma.bulkTank.count({ where: { projectId: id } }),
    prisma.user.count({ where: { projectId: id } }),
    prisma.budget.count({ where: { projectId: id } }),
    prisma.fuelIssueCorrection.count({ where: { projectId: id } }),
    prisma.bill.count({ where: { projectId: id } }),
  ]);
  // Fuel is counted through the pump, which is how the site's litres are read
  // everywhere else in the system.
  const tankIds = (await prisma.bulkTank.findMany({ where: { projectId: id }, select: { id: true } })).map((t) => t.id);
  const fuel = tankIds.length
    ? await prisma.fuelIssue.aggregate({ where: { bulkTankId: { in: tankIds }, voided: false }, _count: { _all: true }, _sum: { litres: true } })
    : { _count: { _all: 0 }, _sum: { litres: 0 } };
  return { assets, assignments, allocations, tanks, users, budgets, corrections, bills,
    issues: fuel._count._all, litres: fuel._sum.litres ?? 0 };
}

const line = (p: { code: string; name: string }, c: Awaited<ReturnType<typeof census>>) =>
  `    ${p.code.padEnd(12)} "${p.name}"\n` +
  `      ${c.issues} issues (${c.litres.toLocaleString()} L) · ${c.tanks} pump(s) · ${c.assets} vehicles · ` +
  `${c.assignments} postings · ${c.allocations} allocations · ${c.users} staff · ${c.budgets} budgets · ${c.bills} bills`;

async function survey() {
  console.log("");
  announceDatabase();
  const all = await prisma.project.findMany({ orderBy: { code: "asc" } });
  console.log(`\n=== ${all.length} sites ===`);

  // Two tiers, because they warrant different confidence. A code or name that
  // normalises to the SAME string is one site written two ways and safe to act
  // on. One name merely containing another is usually two real sites —
  // "Badalgama Plant" and "Badalgama Workshop" are separate places — so those
  // are reported to be judged, never presented as duplicates.
  const same: [typeof all[number], typeof all[number]][] = [];
  const maybe: [typeof all[number], typeof all[number]][] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (norm(a.code) === norm(b.code) || norm(a.name) === norm(b.name)) { same.push([a, b]); continue; }
      if (norm(a.name).includes(norm(b.name)) || norm(b.name).includes(norm(a.name))) maybe.push([a, b]);
    }
  }
  if (!same.length && !maybe.length) { console.log("\n  No two sites look like the same site.\n"); return; }

  for (const [a, b] of same) {
    console.log(`\n  SAME SITE, WRITTEN TWO WAYS:`);
    console.log(line(a, await census(a.id)));
    console.log(line(b, await census(b.id)));
  }
  for (const [a, b] of maybe) {
    console.log(`\n  RELATED NAMES — probably two real sites, check before merging:`);
    console.log(line(a, await census(a.id)));
    console.log(line(b, await census(b.id)));
  }
  console.log(`\n  To merge:  npx tsx scripts/merge_projects.ts --from="loser-code" --into="keeper-code"\n`);
}

async function main() {
  if (!FROM || !INTO) return survey();

  console.log(`\n=== merge sites (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();
  const from = await find(FROM);
  const into = await find(INTO);
  if (from.id === into.id) throw new Error("--from and --into resolve to the same site");

  const cf = await census(from.id), ci = await census(into.id);
  console.log(`\n  FROM (deleted)`);
  console.log(line(from, cf));
  console.log(`  INTO (survives)`);
  console.log(line(into, ci));

  // Budgets: the unique (projectId, year, month) means the loser's budget for a
  // month the survivor also budgets cannot simply move.
  const fromBudgets = await prisma.budget.findMany({ where: { projectId: from.id }, select: { id: true, year: true, month: true, budgetLitres: true } });
  const intoKeys = new Set((await prisma.budget.findMany({ where: { projectId: into.id }, select: { year: true, month: true } }))
    .map((b) => `${b.year}-${b.month}`));
  const clashing = fromBudgets.filter((b) => intoKeys.has(`${b.year}-${b.month}`));
  if (clashing.length) {
    console.log(`\n  ${clashing.length} budget(s) exist on BOTH sites — the survivor's is kept, these are dropped:`);
    for (const b of clashing) console.log(`      ${b.year}-${String(b.month).padStart(2, "0")}  ${b.budgetLitres ?? "—"} L`);
  }

  // Postings: the same vehicle sent to both spellings on the same day is one
  // posting. Compared in memory — a DateTime equality filter is not reliable
  // against this database, where dates are stored in more than one form.
  const fromAsg = await prisma.assetAssignment.findMany({ where: { projectId: from.id }, select: { id: true, assetId: true, startDate: true } });
  const intoAsg = await prisma.assetAssignment.findMany({ where: { projectId: into.id }, select: { assetId: true, startDate: true } });
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const intoAsgKeys = new Set(intoAsg.map((a) => `${a.assetId}|${day(a.startDate)}`));
  const dupAsg = fromAsg.filter((a) => intoAsgKeys.has(`${a.assetId}|${day(a.startDate)}`));
  if (dupAsg.length) console.log(`\n  ${dupAsg.length} posting(s) already recorded on ${into.code} for the same vehicle and day — dropped as duplicates`);

  console.log(`\n  after the merge, ${into.code} holds:`);
  console.log(`      ${cf.issues + ci.issues} issues (${(cf.litres + ci.litres).toLocaleString()} L) · ${cf.tanks + ci.tanks} pump(s) · ` +
    `${cf.assets + ci.assets} vehicles · ${cf.assignments + ci.assignments - dupAsg.length} postings · ` +
    `${cf.allocations + ci.allocations} allocations · ${cf.users + ci.users} staff`);
  if (cf.tanks + ci.tanks > 1) {
    console.log(`\n  ! ${cf.tanks + ci.tanks} pumps end up on one site. Run merge_tanks.ts afterwards`);
    console.log(`    unless the site genuinely has that many.`);
  }
  console.log(`    "${from.code}" is deleted`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }

  await prisma.$transaction(async (tx) => {
    await tx.assetAssignment.deleteMany({ where: { id: { in: dupAsg.map((a) => a.id) } } });
    await tx.budget.deleteMany({ where: { id: { in: clashing.map((b) => b.id) } } });

    await tx.asset.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.assetAssignment.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.vehicleAllocation.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.bulkTank.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.user.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.budget.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.fuelIssueCorrection.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    // Snapshots: repoint the id so the site filter finds them, but leave the
    // name and code text as the document was issued.
    await tx.bill.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });
    await tx.billLineItem.updateMany({ where: { projectId: from.id }, data: { projectId: into.id } });

    await tx.project.delete({ where: { id: from.id } });
  });

  console.log(`\nDone. "${from.code}" folded into "${into.code}".\n`);
}

main().finally(() => prisma.$disconnect());
