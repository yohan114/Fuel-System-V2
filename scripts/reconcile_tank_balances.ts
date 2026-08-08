import { prisma } from "../src/lib/db";

// One-time reconciliation of BulkTank.balance for fuel-issue corrections that
// were APPROVED before the tank-balance fix landed. Issuing fuel decremented the
// tank, but an approved VOID / litres-EDIT never returned it. For each such
// correction we add back exactly what the fix now applies live:
//   VOID              -> + origLitres (full draw returned)
//   EDIT (litres)     -> + (origLitres - newLitres)   (fuel returned if reduced)
// Only corrections whose underlying issue drew from a bulk tank count.
// Dry-run by default; pass --apply.

const APPLY = process.argv.includes("--apply");
const ADMIN = "023cee32-d4e2-4b39-b868-11fd1ce98181";

async function main() {
  const corrs = await prisma.fuelIssueCorrection.findMany({
    where: { status: "APPROVED", fuelIssue: { bulkTankId: { not: null } } },
    include: { fuelIssue: { include: { bulkTank: true } } },
  });

  const byTank = new Map<string, { name: string; capacity: number; balance: number; owed: number; n: number }>();
  for (const c of corrs) {
    const tank = c.fuelIssue.bulkTank!;
    let owed = 0;
    if (c.type === "VOID") owed = c.origLitres;
    else if (c.newLitres !== null) owed = c.origLitres - c.newLitres; // >0 returns fuel
    if (owed === 0) continue;
    if (!byTank.has(tank.id)) byTank.set(tank.id, { name: tank.name, capacity: tank.capacity, balance: tank.balance, owed: 0, n: 0 });
    const t = byTank.get(tank.id)!;
    t.owed += owed; t.n += 1;
  }

  console.log(`Approved tank-fed corrections: ${corrs.length}  (${APPLY ? "APPLY" : "dry-run"})\n`);
  if (byTank.size === 0) { console.log("No historical tank drift — nothing to reconcile."); await prisma.$disconnect(); return; }
  console.log("TANK                     current    +owedBack   ->  new balance   / cap");
  for (const [id, t] of byTank) {
    const nb = t.balance + t.owed;
    console.log(`  ${t.name.padEnd(22)} ${t.balance.toFixed(1).padStart(9)}  ${("+"+t.owed.toFixed(1)).padStart(10)}   -> ${nb.toFixed(1).padStart(10)}  / ${t.capacity} (${t.n} corr)`);
    if (APPLY) {
      await prisma.$transaction([
        prisma.bulkTank.update({ where: { id }, data: { balance: { increment: t.owed } } }),
        prisma.auditLog.create({ data: { actorId: ADMIN, action: "UPDATE", entity: "BulkTank", entityId: id, summary: `Reconciled tank "${t.name}" balance +${t.owed.toFixed(1)}L for ${t.n} pre-fix approved fuel corrections (void/edit fuel not previously returned)` } }),
      ]);
    }
  }
  const total = [...byTank.values()].reduce((s, t) => s + t.owed, 0);
  console.log(`\nTotal to add back: ${total.toFixed(1)}L across ${byTank.size} tank(s).`);
  if (!APPLY) console.log("Dry-run only. Pass --apply to reconcile.");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
