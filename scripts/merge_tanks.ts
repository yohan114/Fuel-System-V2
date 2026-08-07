import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Fold one bulk tank into another.
//
// A site that ends up with two pump records — usually one seeded with the site
// and one added by hand through the console — splits its own history. Half the
// issues hang off each, neither balance is the real stock, and the pump overview
// shows one site twice. Merging is not a rename: every row that points at the
// losing tank has to be repointed first, or deleting it either fails on the
// foreign key or silently takes its dips with it.
//
// Five things reference a tank, and all five move:
//   FuelIssue.bulkTankId        the fuel it dispensed
//   BulkRequest.bulkTankId      deliveries into it
//   BulkRequest.sourceTankId    transfers OUT of it to somewhere else
//   TankDip.bulkTankId          physical dip readings (cascade-delete, so these
//                               would be destroyed rather than orphaned)
//   User.bulkTankId             the operators posted to it
//
// Balances add. Both numbers are litres physically in a tank; if the site really
// has one pump recorded twice, the stock people have been counting is the sum.
// Pass --keep-balance to take the target's figure unchanged instead.
//
//   npx tsx scripts/merge_tanks.ts                       # list duplicate-looking tanks
//   npx tsx scripts/merge_tanks.ts --from="X" --into="Y"        # dry run
//   npx tsx scripts/merge_tanks.ts --from="X" --into="Y" --apply

const APPLY = process.argv.includes("--apply");
const KEEP_BALANCE = process.argv.includes("--keep-balance");
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FROM = arg("from");
const INTO = arg("into");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Say which file is about to be changed. A server can hold a stale copy of the
// database inside the repo while the app serves one from elsewhere, and a merge
// applied to the wrong file reports success while the site stays broken.
function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
}

async function find(needle: string) {
  const all = await prisma.bulkTank.findMany({ include: { project: { select: { code: true, name: true } } } });
  const exact = all.filter((t) => t.id === needle || norm(t.name) === norm(needle));
  if (exact.length === 1) return exact[0];
  const loose = all.filter((t) => norm(t.name).includes(norm(needle)));
  if (loose.length === 1) return loose[0];
  if (loose.length === 0) throw new Error(`no tank matches "${needle}"`);
  throw new Error(`"${needle}" matches ${loose.length} tanks: ${loose.map((t) => t.name).join(" | ")}`);
}

async function census(id: string) {
  const [issues, litres, reqIn, reqOut, dips, users] = await Promise.all([
    prisma.fuelIssue.count({ where: { bulkTankId: id } }),
    prisma.fuelIssue.aggregate({ where: { bulkTankId: id, voided: false }, _sum: { litres: true } }),
    prisma.bulkRequest.count({ where: { bulkTankId: id } }),
    prisma.bulkRequest.count({ where: { sourceTankId: id } }),
    prisma.tankDip.count({ where: { bulkTankId: id } }),
    prisma.user.count({ where: { bulkTankId: id } }),
  ]);
  return { issues, litres: litres._sum.litres ?? 0, reqIn, reqOut, dips, users };
}

// Without --from/--into, report rather than act: name the pairs that look like
// the same pump recorded twice, so the merge is chosen from evidence.
async function survey() {
  console.log("");
  announceDatabase();
  const all = await prisma.bulkTank.findMany({ include: { project: { select: { code: true, name: true } } }, orderBy: { name: "asc" } });
  console.log(`\n=== ${all.length} tanks ===`);

  const byProject = new Map<string, typeof all>();
  for (const t of all) {
    if (!t.projectId) continue;
    (byProject.get(t.projectId) ?? byProject.set(t.projectId, []).get(t.projectId)!).push(t);
  }
  const sharing = [...byProject.values()].filter((g) => g.length > 1);

  // A tank whose name is another's with "Tank" or the site name stripped is the
  // classic hand-added duplicate.
  const near: [typeof all[number], typeof all[number]][] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = norm(all[i].name), b = norm(all[j].name);
      if (a === b || a.replace(/tank$/, "") === b.replace(/tank$/, "") || a.includes(b) || b.includes(a)) {
        near.push([all[i], all[j]]);
      }
    }
  }

  if (!sharing.length && !near.length) {
    console.log("\n  No two tanks share a site, and no two names look like the same pump.");
    console.log("  Nothing here needs merging.\n");
  }
  for (const g of sharing) {
    console.log(`\n  SAME SITE — ${g[0].project?.code}:`);
    for (const t of g) {
      const c = await census(t.id);
      console.log(`    "${t.name}"  ${t.balance} L  ${c.issues} issues (${c.litres} L) · ${c.reqIn} deliveries · ${c.dips} dips · ${c.users} operators`);
    }
  }
  for (const [a, b] of near) {
    console.log(`\n  SIMILAR NAMES:`);
    for (const t of [a, b]) {
      const c = await census(t.id);
      console.log(`    "${t.name}"  site=${t.project?.code ?? "—"}  ${t.balance} L  ${c.issues} issues (${c.litres} L) · ${c.reqIn} deliveries · ${c.dips} dips · ${c.users} operators`);
    }
  }
  console.log(`\n  To merge:  npx tsx scripts/merge_tanks.ts --from="loser" --into="keeper"\n`);
}

async function main() {
  if (!FROM || !INTO) return survey();

  console.log(`\n=== merge tanks (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  announceDatabase();
  const from = await find(FROM);
  const into = await find(INTO);
  if (from.id === into.id) throw new Error("--from and --into resolve to the same tank");

  const cf = await census(from.id), ci = await census(into.id);
  console.log(`\n  FROM  "${from.name}"  site=${from.project?.code ?? "—"}  ${from.fuelKind}  ${from.balance} L of ${from.capacity}`);
  console.log(`        ${cf.issues} issues (${cf.litres} L) · ${cf.reqIn} deliveries in · ${cf.reqOut} transfers out · ${cf.dips} dips · ${cf.users} operators`);
  console.log(`  INTO  "${into.name}"  site=${into.project?.code ?? "—"}  ${into.fuelKind}  ${into.balance} L of ${into.capacity}`);
  console.log(`        ${ci.issues} issues (${ci.litres} L) · ${ci.reqIn} deliveries in · ${ci.reqOut} transfers out · ${ci.dips} dips · ${ci.users} operators`);

  if (from.fuelKind !== into.fuelKind) {
    throw new Error(`different products (${from.fuelKind} vs ${into.fuelKind}) — these are not the same pump`);
  }
  if (from.projectId && into.projectId && from.projectId !== into.projectId) {
    console.log(`\n  ! different sites (${from.project?.code} vs ${into.project?.code}). Merging moves`);
    console.log(`    ${from.project?.code}'s fuel onto ${into.project?.code}. Continue only if that is right.`);
  }

  // A delivery that came FROM the losing tank INTO the winner becomes a transfer
  // to itself once they are one tank. That is not a real movement, so the source
  // pointer is cleared rather than left circular.
  const selfRefs = await prisma.bulkRequest.count({ where: { sourceTankId: from.id, bulkTankId: into.id } });
  const selfRefs2 = await prisma.bulkRequest.count({ where: { sourceTankId: into.id, bulkTankId: from.id } });
  if (selfRefs + selfRefs2) {
    console.log(`\n  ${selfRefs + selfRefs2} transfer(s) between these two tanks become self-transfers —`);
    console.log(`  their source will be cleared, the delivery itself is kept.`);
  }

  const newBalance = KEEP_BALANCE ? into.balance : into.balance + from.balance;
  console.log(`\n  after the merge:`);
  console.log(`    "${into.name}"  ${cf.issues + ci.issues} issues (${(cf.litres + ci.litres).toLocaleString()} L) · ${cf.reqIn + ci.reqIn} deliveries · ${cf.dips + ci.dips} dips · ${cf.users + ci.users} operators`);
  console.log(`    balance ${into.balance} + ${from.balance} = ${newBalance} L${KEEP_BALANCE ? "  (--keep-balance: staying at " + into.balance + " L)" : ""}`);
  console.log(`    "${from.name}" is deleted`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply\n`); return; }

  await prisma.$transaction(async (tx) => {
    await tx.fuelIssue.updateMany({ where: { bulkTankId: from.id }, data: { bulkTankId: into.id } });
    await tx.bulkRequest.updateMany({ where: { bulkTankId: from.id }, data: { bulkTankId: into.id } });
    await tx.tankDip.updateMany({ where: { bulkTankId: from.id }, data: { bulkTankId: into.id } });
    await tx.user.updateMany({ where: { bulkTankId: from.id }, data: { bulkTankId: into.id } });
    // Transfers out of the loser: repoint, then clear the ones that now point at
    // their own destination.
    await tx.bulkRequest.updateMany({ where: { sourceTankId: from.id }, data: { sourceTankId: into.id } });
    await tx.bulkRequest.updateMany({ where: { sourceTankId: into.id, bulkTankId: into.id }, data: { sourceTankId: null } });
    await tx.bulkTank.update({ where: { id: into.id }, data: { balance: newBalance } });
    await tx.bulkTank.delete({ where: { id: from.id } });
  });

  console.log(`\nDone. "${from.name}" folded into "${into.name}".\n`);
}

main().finally(() => prisma.$disconnect());
