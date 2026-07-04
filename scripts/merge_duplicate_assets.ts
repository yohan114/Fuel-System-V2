/**
 * Merge duplicate vehicle records into the canonical asset.
 *
 * Site importers historically re-created vehicles that already exist in the
 * master fleet — using the registration number as the code (PJ-7604 next to
 * DC-26), a bare numeric sheet id (46065 next to DT-11), or a "#2" suffix
 * re-registration. This script:
 *
 *   1. groups assets sharing a registration identity (see src/lib/fleet/dedupe)
 *   2. keeps the canonical record and copies any missing details onto it
 *   3. migrates fuel issues, meter readings, daily conditions, assignments,
 *      requests, corrections, service records and non-conflicting bills
 *   4. deletes the emptied duplicate — or, when finalized invoices for the
 *      same month exist on both records (one bill per asset-month is a hard
 *      constraint and issued invoices are never deleted), keeps the duplicate
 *      as a DISPOSED tombstone so nothing financial is destroyed
 *
 * Ambiguous groups (two independent E&C codes sharing one registration, or
 * placeholder registrations shared by many machines) are reported, never
 * auto-merged — the same list appears on /admin/data-quality.
 *
 * Usage:
 *   npx tsx scripts/merge_duplicate_assets.ts           # dry run (default)
 *   npx tsx scripts/merge_duplicate_assets.ts --apply   # execute
 */
import fs from "fs";
import path from "path";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { planMerges, detailScore, ASSET_DETAIL_FIELDS, type DedupeAsset } from "../src/lib/fleet/dedupe";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

const DETAIL_FIELDS = ASSET_DETAIL_FIELDS;

async function loadPlan() {
  const assets = await prisma.asset.findMany({ include: { rentalRate: { select: { id: true } } } });
  const planInput: DedupeAsset[] = assets.map((a) => ({
    id: a.id,
    code: a.code,
    regNo: a.regNo,
    status: a.status,
    createdAt: a.createdAt,
    detailScore: detailScore(a),
  }));
  return { plan: planMerges(planInput), assetById: new Map(assets.map((a) => [a.id, a])) };
}

async function rowCounts(assetId: string) {
  const [fi, litres, mr, dc, asg, bills, finBills] = await Promise.all([
    prisma.fuelIssue.count({ where: { assetId, voided: false } }),
    prisma.fuelIssue.aggregate({ where: { assetId, voided: false }, _sum: { litres: true } }),
    prisma.meterReading.count({ where: { assetId } }),
    prisma.dailyCondition.count({ where: { assetId } }),
    prisma.assetAssignment.count({ where: { assetId } }),
    prisma.bill.count({ where: { assetId } }),
    prisma.bill.count({ where: { assetId, status: { not: "DRAFT" } } }),
  ]);
  return { fi, litres: Math.round(litres._sum.litres ?? 0), mr, dc, asg, bills, finBills };
}

async function mergeOne(tx: Prisma.TransactionClient, survivorId: string, dupId: string) {
  const survivor = (await tx.asset.findUnique({ where: { id: survivorId }, include: { rentalRate: true, serviceIntervalOverride: true } }))!;
  const dup = (await tx.asset.findUnique({ where: { id: dupId }, include: { rentalRate: true, serviceIntervalOverride: true } }))!;

  // 1. Copy details the survivor is missing.
  const fill: Record<string, unknown> = {};
  for (const f of DETAIL_FIELDS) {
    if ((survivor[f] == null || survivor[f] === "") && dup[f] != null && dup[f] !== "") fill[f] = dup[f];
  }
  if (Object.keys(fill).length > 0) await tx.asset.update({ where: { id: survivor.id }, data: fill });

  // 2. One rate card / interval override per asset: keep the survivor's, move
  //    the duplicate's only when the survivor has none.
  if (dup.rentalRate) {
    if (survivor.rentalRate) await tx.rentalRate.delete({ where: { id: dup.rentalRate.id } });
    else await tx.rentalRate.update({ where: { id: dup.rentalRate.id }, data: { assetId: survivor.id } });
  }
  if (dup.serviceIntervalOverride) {
    if (survivor.serviceIntervalOverride) await tx.serviceInterval.delete({ where: { id: dup.serviceIntervalOverride.id } });
    else await tx.serviceInterval.update({ where: { id: dup.serviceIntervalOverride.id }, data: { assetId: survivor.id } });
  }

  // 3. Straight re-points (no per-asset uniqueness).
  await tx.fuelIssue.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });
  await tx.fuelRequest.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });
  await tx.meterReading.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });
  await tx.serviceRecord.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });
  await tx.fuelIssueCorrection.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });

  // 4. Daily conditions: one row per asset-day — on a clash keep the survivor's.
  const survivorDays = new Set(
    (await tx.dailyCondition.findMany({ where: { assetId: survivor.id }, select: { logDate: true } })).map((d) =>
      d.logDate.getTime()
    )
  );
  const dupConds = await tx.dailyCondition.findMany({ where: { assetId: dup.id }, select: { id: true, logDate: true } });
  const clashIds = dupConds.filter((d) => survivorDays.has(d.logDate.getTime())).map((d) => d.id);
  let conditionClashes = 0;
  if (clashIds.length > 0) {
    conditionClashes = (await tx.dailyCondition.deleteMany({ where: { id: { in: clashIds } } })).count;
  }
  await tx.dailyCondition.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });

  // 5. Assignments: drop rows identical to one the survivor already has.
  const survAsg = await tx.assetAssignment.findMany({
    where: { assetId: survivor.id },
    select: { projectId: true, startDate: true, endDate: true },
  });
  const asgKey = (a: { projectId: string; startDate: Date; endDate: Date | null }) =>
    `${a.projectId}|${a.startDate.getTime()}|${a.endDate?.getTime() ?? "open"}`;
  const survAsgKeys = new Set(survAsg.map(asgKey));
  const dupAsg = await tx.assetAssignment.findMany({ where: { assetId: dup.id } });
  const dupAsgIds = dupAsg.filter((a) => survAsgKeys.has(asgKey(a))).map((a) => a.id);
  if (dupAsgIds.length > 0) await tx.assetAssignment.deleteMany({ where: { id: { in: dupAsgIds } } });
  await tx.assetAssignment.updateMany({ where: { assetId: dup.id }, data: { assetId: survivor.id } });

  // 6. Bills: one per asset-month. Move what fits; drop clashing DRAFTs;
  //    clashing finalized invoices stay on the duplicate (tombstone case).
  const survPeriods = new Set(
    (await tx.bill.findMany({ where: { assetId: survivor.id }, select: { periodKey: true } })).map((b) => b.periodKey)
  );
  const dupBills = await tx.bill.findMany({ where: { assetId: dup.id }, select: { id: true, periodKey: true, status: true } });
  const movable = dupBills.filter((b) => !survPeriods.has(b.periodKey));
  const clashingDrafts = dupBills.filter((b) => survPeriods.has(b.periodKey) && b.status === "DRAFT");
  const blockers = dupBills.filter((b) => survPeriods.has(b.periodKey) && b.status !== "DRAFT");
  // moving two same-period bills from ONE duplicate is impossible (unique per
  // asset already), so a plain re-point per id is safe here
  for (const b of movable) await tx.bill.update({ where: { id: b.id }, data: { assetId: survivor.id } });
  if (clashingDrafts.length > 0)
    await tx.bill.deleteMany({ where: { id: { in: clashingDrafts.map((b) => b.id) } } });

  // 7. Remove — or tombstone when finalized invoices must stay behind.
  let outcome: "deleted" | "tombstoned";
  if (blockers.length === 0) {
    await tx.asset.delete({ where: { id: dup.id } });
    outcome = "deleted";
  } else {
    await tx.asset.update({ where: { id: dup.id }, data: { status: "DISPOSED", site: `MERGED INTO ${survivor.code}` } });
    outcome = "tombstoned";
  }
  return { outcome, blockers: blockers.length, movedBills: movable.length, droppedDrafts: clashingDrafts.length, conditionClashes, droppedDupAssignments: dupAsgIds.length };
}

async function main() {
  const { plan, assetById } = await loadPlan();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to execute)"}\n`);
  if (plan.merges.length === 0) console.log("No mergeable duplicate groups found.");

  const totalBefore = await prisma.fuelIssue.aggregate({ where: { voided: false }, _count: true, _sum: { litres: true } });

  for (const m of plan.merges) {
    const s = assetById.get(m.survivor.id)!;
    console.log(`── ${s.code}  (survivor, reg=${s.regNo ?? "—"})`);
    for (const d of m.duplicates) {
      const c = await rowCounts(d.id);
      console.log(
        `   ⇐ ${d.code.padEnd(11)} fuel=${c.fi}(${c.litres}L) reads=${c.mr} cond=${c.dc} asg=${c.asg} bills=${c.bills}(finalized ${c.finBills})`
      );
      if (APPLY) {
        const res = await prisma.$transaction((tx) => mergeOne(tx, m.survivor.id, d.id));
        console.log(
          `     → ${res.outcome}${res.blockers ? ` (${res.blockers} finalized invoice(s) stay on the tombstone)` : ""}; bills moved=${res.movedBills}, clashing drafts dropped=${res.droppedDrafts}, condition-day clashes dropped=${res.conditionClashes}, duplicate assignments dropped=${res.droppedDupAssignments}`
        );
        await prisma.auditLog.create({
          data: {
            actorId: admin?.id ?? null,
            action: "UPDATE",
            entity: "Asset",
            entityId: m.survivor.id,
            summary: `Merged duplicate vehicle ${d.code} into ${s.code} (${res.outcome}${res.blockers ? `, ${res.blockers} finalized invoices retained on tombstone` : ""})`,
            metaJson: JSON.stringify({ duplicateId: d.id, duplicateCode: d.code, ...res }),
          },
        });
      }
    }
  }

  if (plan.ambiguous.length > 0) {
    console.log(`\nAmbiguous groups (NOT merged — decide manually, also shown on /admin/data-quality):`);
    for (const g of plan.ambiguous) console.log(`   ${g.key.padEnd(10)} ${g.codes.join(" | ")}  [${g.reason}]`);
  }

  if (APPLY) {
    const totalAfter = await prisma.fuelIssue.aggregate({ where: { voided: false }, _count: true, _sum: { litres: true } });
    const same =
      totalAfter._count === totalBefore._count &&
      Math.round(totalAfter._sum.litres ?? 0) === Math.round(totalBefore._sum.litres ?? 0);
    console.log(
      `\nFuel-issue conservation: ${totalBefore._count} → ${totalAfter._count} issues, ${Math.round(totalBefore._sum.litres ?? 0)} → ${Math.round(totalAfter._sum.litres ?? 0)} L ${same ? "✓" : "✗ MISMATCH"}`
    );
    if (!same) process.exitCode = 1;
    const { plan: replan } = await loadPlan();
    console.log(`Remaining mergeable groups after apply: ${replan.merges.length} (ambiguous: ${replan.ambiguous.length})`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
