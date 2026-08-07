// Retire the two Galagedara rows that survived under a misread plate.
//
// The monthly workbook resolves each refuel to a tidied vehicle name and keeps
// the raw plate beside it, and its own "Names merged" note states the mapping:
//   DAG-4929 and DAC-4967 -> DAG-4969
//   LA-0920               -> LL-0920   (fleet code DT-02)
// The earlier stock-book import predated that mapping and registered the raw
// spellings as machines in their own right, so the same two refuels are now
// filed twice: once against the real vehicle, once against a plate that does
// not exist. Deleting the orphans leaves Galagedara at exactly the workbook's
// 436 issues and 18,403 L.
//
// GE-47 is a different case and is only renamed. It is one genuine refuel — the
// 172 L on 05 Aug — whose plate was unclear in the photograph; the workbook
// reads it GE-M47. Nothing duplicates it, so the row stays and the label is
// corrected.
//
// Dry-run unless --apply.
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");

// code -> the vehicle the workbook says it really is. null means "delete the
// issues and the phantom asset"; a string means "rename in place".
const ORPHANS = ["DAG-4929", "LA-0920"];
const RENAMES: Record<string, string> = { "GE-47": "GE-M47" };

async function main() {
  console.log(`\n=== Galagedara alias cleanup (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  const project = await prisma.project.findUnique({ where: { code: "CEP-03F" } });
  if (!project) throw new Error("project CEP-03F not found");
  const tank = await prisma.bulkTank.findFirst({ where: { projectId: project.id } });
  if (!tank) throw new Error("Galagedara has no tank");

  const before = await prisma.fuelIssue.findMany({
    where: { bulkTankId: tank.id, voided: false }, select: { litres: true } });
  console.log(`before: ${before.length} issues · ${before.reduce((s, i) => s + i.litres, 0).toLocaleString()} L\n`);

  let removedIssues = 0, removedLitres = 0;

  for (const code of ORPHANS) {
    const asset = await prisma.asset.findFirst({ where: { code } });
    if (!asset) { console.log(`  ${code}: already gone`); continue; }

    // Only ever delete what sits on this tank. If the plate somehow picked up
    // fuel elsewhere it is not this import's to touch.
    const mine = await prisma.fuelIssue.findMany({
      where: { assetId: asset.id, bulkTankId: tank.id },
      select: { id: true, litres: true, issueDate: true, source: true } });
    const elsewhere = await prisma.fuelIssue.count({
      where: { assetId: asset.id, bulkTankId: { not: tank.id } } });

    for (const r of mine) {
      const d = r.issueDate.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
      console.log(`  delete  ${d}  ${code.padEnd(10)} ${String(r.litres).padStart(4)} L  ${r.source}`);
      removedIssues++; removedLitres += r.litres;
    }
    if (elsewhere > 0) {
      console.log(`  keep    ${code} — ${elsewhere} issue(s) on another tank, asset retained`);
    } else {
      console.log(`  drop    asset ${code} (no fuel left anywhere)`);
    }

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.fuelIssue.deleteMany({ where: { id: { in: mine.map((r) => r.id) } } });
        if (elsewhere === 0) {
          await tx.assetAssignment.deleteMany({ where: { assetId: asset.id } });
          await tx.asset.delete({ where: { id: asset.id } });
        }
      });
    }
  }

  for (const [from, to] of Object.entries(RENAMES)) {
    const asset = await prisma.asset.findFirst({ where: { code: from } });
    if (!asset) { console.log(`\n  ${from}: not present`); continue; }
    const target = await prisma.asset.findFirst({ where: { code: to } });
    const n = await prisma.fuelIssue.count({ where: { assetId: asset.id } });

    // A later fuel sync replays an export that still spells it the old way, so
    // the source code can reappear after the rename has already happened. Fold
    // it into the target rather than skipping, or the same refuel ends up on two
    // assets and the vehicle's history splits in half.
    if (target) {
      console.log(`\n  merge   ${from} -> ${to}  (${to} already exists; ${n} issue(s) move across, none deleted)`);
      if (APPLY) {
        await prisma.$transaction(async (tx) => {
          await tx.fuelIssue.updateMany({ where: { assetId: asset.id }, data: { assetId: target.id } });
          await tx.assetAssignment.deleteMany({ where: { assetId: asset.id } });
          await tx.asset.delete({ where: { id: asset.id } });
        });
      }
      continue;
    }

    console.log(`\n  rename  ${from} -> ${to}  (${n} issue(s) follow the asset, none deleted)`);
    if (APPLY) await prisma.asset.update({ where: { id: asset.id }, data: { code: to } });
  }

  console.log(`\n  ${removedIssues} issue(s) · ${removedLitres} L would be removed`);
  const after = before.length - removedIssues;
  const afterL = before.reduce((s, i) => s + i.litres, 0) - removedLitres;
  console.log(`  after : ${after} issues · ${afterL.toLocaleString()} L   (workbook: 436 · 18,403 L)`);

  // The tank balance moves with the fuel: 30 L that was never issued goes back.
  console.log(`\n  tank balance ${tank.balance} L -> ${tank.balance + removedLitres} L`);
  if (APPLY) await prisma.bulkTank.update({ where: { id: tank.id }, data: { balance: tank.balance + removedLitres } });

  console.log(APPLY ? "\napplied.\n" : "\nnothing written — re-run with --apply\n");
}

main().finally(() => prisma.$disconnect());
