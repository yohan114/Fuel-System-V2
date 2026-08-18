import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// One-off cleanup of duplicate Asset rows.
//
// The fleet was imported with the same physical vehicle entered twice: once
// under its real E&C number and once under its registration plate (or a "46###"
// fuel-card code). This script resolves those, in three groups:
//
//   ① Empty plate-coded duplicates of a real E&C asset  -> soft-dispose
//      (mark DISPOSED, keep the row — matches the app's own delete convention).
//   ② "46###" rows that duplicate a real vehicle but carry real fuel/condition
//      history -> re-point that history to the canonical vehicle, then hard-
//      delete the now-empty "46###" row.
//   ③ Empty "stub" rows where a second E&C/plate code shadows the real record
//      -> soft-dispose the stub, keep the informative record.
//
// Distinct vehicles that merely share a placeholder registration (the FIORI
// mixers, the "14160" excavators) are NOT touched. Pairs whose canonical code
// is genuinely ambiguous (LA-4229 DT-52/WB-05 — conflicting makes; RF-0748
// FT-11/FT-05 — same prefix) are left for a human and printed at the end.
//
// Dry-run by default; pass --apply to write. Idempotent and safe to re-run.

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

// ① + ③ — codes to soft-dispose (empty duplicates; canonical kept alongside).
const SOFT_DISPOSE: { code: string; keep: string; note: string }[] = [
  { code: "PJ-7604", keep: "DC-26", note: "plate used as code" },
  { code: "LJ-5559", keep: "DT-29", note: "plate used as code" },
  { code: "LI-7620", keep: "DT-08", note: "plate used as code" },
  { code: "LI-7701", keep: "DT-09", note: "plate used as code" },
  { code: "LM-5722", keep: "DT-15", note: "plate used as code" },
  { code: "RA-3052", keep: "FT-04", note: "plate used as code" },
  { code: "RY-2390", keep: "WB-15", note: "plate used as code" },
  { code: "RY-2390#2", keep: "WB-15", note: "plate used as code (dupe suffix)" },
  { code: "RY-2390#3", keep: "WB-15", note: "plate used as code (dupe suffix)" },
  { code: "RV-1990#2", keep: "RV-1990", note: "duplicate suffix" },
  { code: "WB-03", keep: "DT-41", note: "stub of DT-41 (reg HO-9850)" },
  { code: "WB-09", keep: "TB-09", note: "empty stub of TB-09 (reg RY-0299)" },
  { code: "WB-10", keep: "TB-11", note: "empty stub of TB-11 (reg RY-0301)" },
  { code: "WB-11", keep: "TB-10", note: "empty stub of TB-10 (reg RY-0304)" },
];

// ② — "46###" rows to merge into their canonical vehicle, then delete.
const MIGRATE_DELETE: { dup: string; canonical: string }[] = [
  { dup: "46073", canonical: "VR-59" },
  { dup: "46052", canonical: "DT-43" },
  { dup: "46058", canonical: "HCC-06" },
  { dup: "46059", canonical: "HCC-06" },
  { dup: "46065", canonical: "DT-11" },
  { dup: "46370", canonical: "GJ-8775" },
  { dup: "46386", canonical: "GJ-8775" },
];

// Ambiguous — reported, never touched.
const AMBIGUOUS = [
  "LA-4229: DT-52 (TATA Comet) vs WB-05 (Ashok Leyland Comet) — conflicting makes",
  "RF-0748: FT-11 vs FT-05 (both Massey Ferguson) — same prefix, cannot tell which is canonical",
];

async function adminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  return admin?.id ?? null;
}

async function assetByCode(code: string) {
  return prisma.asset.findUnique({ where: { code } });
}

async function main() {
  const before = await prisma.asset.count();
  console.log(`=== DEDUPE ASSETS  (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Assets before: ${before}\n`);
  const actor = await adminId();

  // ---- ① + ③ soft-dispose ------------------------------------------------
  console.log("① + ③  Soft-dispose empty duplicates (mark DISPOSED):");
  let disposed = 0;
  for (const { code, keep, note } of SOFT_DISPOSE) {
    const a = await assetByCode(code);
    const canonical = await assetByCode(keep);
    if (!a) { console.log(`   · ${code.padEnd(11)} — not found, skip`); continue; }
    if (!canonical) { console.log(`   ! ${code.padEnd(11)} — canonical ${keep} MISSING, skip (would orphan)`); continue; }
    const bills = await prisma.bill.count({ where: { assetId: a.id } });
    if (bills > 0) { console.log(`   ! ${code.padEnd(11)} — has ${bills} bills, skip (won't dispose billed asset)`); continue; }
    if (a.status === "DISPOSED") { console.log(`   = ${code.padEnd(11)} — already DISPOSED`); continue; }
    console.log(`   → ${code.padEnd(11)} DISPOSED, keep ${keep.padEnd(9)} (${note})`);
    if (APPLY) {
      await prisma.$transaction([
        prisma.asset.update({ where: { id: a.id }, data: { status: "DISPOSED" } }),
        prisma.auditLog.create({ data: {
          actorId: actor, action: "UPDATE", entity: "Asset", entityId: a.id,
          summary: `Dedupe: marked duplicate asset ${code} DISPOSED (canonical ${keep})`,
        } }),
      ]);
    }
    disposed++;
  }

  // ---- ② migrate history, then hard-delete -------------------------------
  console.log("\n②  Migrate fuel + conditions to canonical, then delete '46###':");
  let deleted = 0;
  for (const { dup, canonical } of MIGRATE_DELETE) {
    const d = await assetByCode(dup);
    const c = await assetByCode(canonical);
    if (!d) { console.log(`   · ${dup} — not found, skip`); continue; }
    if (!c) { console.log(`   ! ${dup} — canonical ${canonical} MISSING, skip`); continue; }
    const bills = await prisma.bill.count({ where: { assetId: d.id } });
    if (bills > 0) { console.log(`   ! ${dup} — has ${bills} bills, skip (won't delete billed asset)`); continue; }

    const fuelN = await prisma.fuelIssue.count({ where: { assetId: d.id } });
    const conds = await prisma.dailyCondition.findMany({ where: { assetId: d.id } });
    const meters = await prisma.meterReading.count({ where: { assetId: d.id } });
    const assigns = await prisma.assetAssignment.count({ where: { assetId: d.id } });
    // Split conditions: those whose (canonical, logDate) already exists must be
    // dropped (unique constraint); the rest re-point.
    let condMove = 0, condDrop = 0;
    for (const cond of conds) {
      const clash = await prisma.dailyCondition.findUnique({
        where: { assetId_logDate: { assetId: c.id, logDate: cond.logDate } },
      });
      if (clash) condDrop++; else condMove++;
    }
    const cFuelBefore = await prisma.fuelIssue.count({ where: { assetId: c.id } });
    console.log(`   → ${dup} → ${canonical}: fuel ${fuelN} re-point (${canonical} ${cFuelBefore}→${cFuelBefore + fuelN}), meters ${meters}, conditions ${condMove} move / ${condDrop} drop-dupe, assignments ${assigns} cascade-delete`);

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        await tx.fuelIssue.updateMany({ where: { assetId: d.id }, data: { assetId: c.id } });
        if (meters > 0) await tx.meterReading.updateMany({ where: { assetId: d.id }, data: { assetId: c.id } });
        for (const cond of conds) {
          const clash = await tx.dailyCondition.findUnique({
            where: { assetId_logDate: { assetId: c.id, logDate: cond.logDate } },
          });
          if (clash) await tx.dailyCondition.delete({ where: { id: cond.id } });
          else await tx.dailyCondition.update({ where: { id: cond.id }, data: { assetId: c.id } });
        }
        // Remaining children: assignments cascade on delete; rate/service/etc are 0.
        await tx.asset.delete({ where: { id: d.id } }); // assignments cascade
        await tx.auditLog.create({ data: {
          actorId: actor, action: "DELETE", entity: "Asset", entityId: d.id,
          summary: `Dedupe: merged ${dup} into ${canonical} (moved ${fuelN} fuel, ${condMove} conditions; dropped ${condDrop} dupe conditions) and deleted the duplicate`,
        } });
      });
    }
    deleted++;
  }

  console.log("\n③  Ambiguous — left for review:");
  for (const line of AMBIGUOUS) console.log(`   ? ${line}`);

  const after = APPLY ? await prisma.asset.count() : before - deleted;
  console.log(`\nSummary: ${disposed} soft-disposed, ${deleted} merged+deleted. Assets ${before} → ${after}${APPLY ? "" : " (projected)"}.`);
  if (!APPLY) console.log("\nDry-run only. Re-run with --apply to write.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
