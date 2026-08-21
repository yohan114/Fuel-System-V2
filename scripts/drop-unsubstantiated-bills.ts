/**
 * Remove bills for months in which the vehicle had no site posting.
 *
 * Billing used to fall back to `Asset.projectId` — a "site pin" on the vehicle
 * record — whenever no posting covered the month. That pin is a second source of
 * truth, and it disagreed with the fuel-derived postings on 98 vehicles and
 * existed without any posting at all on 34 more. It is how three generators that
 * have never drawn a litre of diesel came to be invoiced to Wadakada.
 *
 * generate.ts no longer reads the pin, but regenerating does not clear the bills
 * it already produced: an asset with no posting returns "skipped-not-here" and
 * the stale bill simply stays. This deletes them.
 *
 * SAFETY: only DRAFT bills are touched. An issued invoice has gone to a client
 * and is a commercial fact; correcting one is a credit note, not a delete. Every
 * removed bill is written into the AuditLog in full first, so the value and the
 * reasoning survive the deletion.
 *
 *   npx tsx scripts/drop-unsubstantiated-bills.ts            # dry run
 *   npx tsx scripts/drop-unsubstantiated-bills.ts --apply
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);

async function main() {
  // A bill is unsubstantiated when no AssetAssignment overlaps its month. The
  // Colombo day rule applies to the posting dates: a calendar day is stored at
  // 18:30Z on the previous day, so comparing the raw columns would be a day out.
  const rows = await prisma.$queryRawUnsafe<
    {
      id: string; assetCode: string; assetId: string; periodKey: string; projectName: string | null;
      status: string; grandTotalCents: number; anyFuel: bigint; anyPosting: bigint;
    }[]
  >(`
    SELECT b.id, b.assetCode, b.assetId, b.periodKey, b.projectName, b.status, b.grandTotalCents,
      (SELECT COUNT(*) FROM FuelIssue f WHERE f.assetId = b.assetId AND f.voided = 0) AS anyFuel,
      (SELECT COUNT(*) FROM AssetAssignment aa WHERE aa.assetId = b.assetId
         AND date(datetime(aa.startDate,'+5 hours','+30 minutes'))
             <= date(b.year || '-' || substr('0' || b.month, -2) || '-01', '+1 month', '-1 day')
         AND COALESCE(date(datetime(aa.endDate,'+5 hours','+30 minutes')), '9999-12-31')
             >= date(b.year || '-' || substr('0' || b.month, -2) || '-01')) AS anyPosting
    FROM Bill b
    ORDER BY b.periodKey, b.assetCode
  `);

  const unsubstantiated = rows.filter((r) => Number(r.anyPosting) === 0);
  const drafts = unsubstantiated.filter((r) => r.status === "DRAFT");
  const issued = unsubstantiated.filter((r) => r.status !== "DRAFT");

  console.log(`\n════ UNSUBSTANTIATED BILLS  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
  console.log(`  bills examined                 ${rows.length}`);
  console.log(`  no site posting for the month  ${unsubstantiated.length}`);
  console.log(`  of those, DRAFT (removable)    ${drafts.length}`);
  console.log(`  of those, already issued       ${issued.length}${issued.length ? "  ⚠ left alone — these need credit notes, not deletion" : ""}`);

  if (drafts.length) {
    console.log(`\n  ${pad("asset", 12)}${pad("period", 9)}${pad("site billed", 24)}${padL("value", 16)}   fuel history`);
    for (const r of drafts) {
      console.log(
        `  ${pad(r.assetCode, 12)}${pad(r.periodKey, 9)}${pad(r.projectName || "—", 24)}${padL(rs(r.grandTotalCents), 16)}   ` +
        (Number(r.anyFuel) === 0 ? "never drawn fuel anywhere" : `${r.anyFuel} fuel issues, none placing it here that month`)
      );
    }
    const total = drafts.reduce((s, r) => s + r.grandTotalCents, 0);
    const byMonth = new Map<string, number>();
    for (const r of drafts) byMonth.set(r.periodKey, (byMonth.get(r.periodKey) ?? 0) + r.grandTotalCents);
    console.log(`\n  ── value removed ──`);
    for (const [m, v] of [...byMonth.entries()].sort()) console.log(`  ${m}   ${padL(rs(v), 16)}`);
    console.log(`  ${pad("TOTAL", 9)}${padL(rs(total), 16)}`);
  }

  if (!APPLY) {
    console.log(`\n(DRY-RUN) nothing deleted — re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }
  if (drafts.length === 0) {
    console.log(`\nNothing to remove.`);
    await prisma.$disconnect();
    return;
  }

  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const full = await prisma.bill.findMany({ where: { id: { in: drafts.map((d) => d.id) } } });

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Bill",
        entityId: null,
        actorId: admin?.id ?? null,
        summary:
          `Removed ${drafts.length} draft bill(s) worth ${rs(drafts.reduce((s, r) => s + r.grandTotalCents, 0))} for months in which the vehicle had no site posting. ` +
          `These were produced by the old fallback to Asset.projectId, the site pin on the vehicle record, which billed a machine to a site on no evidence that it was ever there — ` +
          `${drafts.filter((d) => Number(d.anyFuel) === 0).length} of them have never drawn fuel anywhere. ` +
          `Billing now requires a posting: fuel from that site's tank, or a MANUAL allocation. The full bills are recorded here.`,
        metaJson: JSON.stringify({
          removed: full.map((b) => ({
            id: b.id, assetCode: b.assetCode, periodKey: b.periodKey, projectName: b.projectName,
            status: b.status, billableUnits: b.billableUnits, minimumUnits: b.minimumUnits,
            rateCents: b.rateCents, rentalAmountCents: b.rentalAmountCents,
            fuelCostCents: b.fuelCostCents, grandTotalCents: b.grandTotalCents,
          })),
        }),
      },
    });
    await tx.billLineItem.deleteMany({ where: { billId: { in: drafts.map((d) => d.id) } } });
    await tx.bill.deleteMany({ where: { id: { in: drafts.map((d) => d.id) }, status: "DRAFT" } });
  });

  const left = await prisma.bill.count({ where: { id: { in: drafts.map((d) => d.id) } } });
  const orphanLines = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM BillLineItem li WHERE NOT EXISTS (SELECT 1 FROM Bill b WHERE b.id = li.billId)`
  );
  console.log(`\n── RECONCILIATION ──`);
  console.log(`  bills removed              ${drafts.length}`);
  console.log(`  of those still present     ${left}   (must be 0)`);
  console.log(`  orphaned line items        ${orphanLines[0].n}   (must be 0)`);
  if (left > 0 || Number(orphanLines[0].n) > 0) process.exit(1);
  console.log(`\n✓ Done. The removed bills are recorded in full in the AuditLog entry.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
