/**
 * Remove the Lot-04 pump-totaliser values that were imported as vehicle meters.
 *
 * WHAT HAPPENED: the "Lot-04 fuel issue register (Jul–Aug 2026)" sheet carried a
 * column holding the bulk tank's cumulative dispensed-litres counter. The import
 * read it as each vehicle's odometer. Proof: across 25 Jul – 13 Aug 2026 the
 * values span 27,248 → 32,122 = 4,874 units, while the litres actually issued
 * from the EP I-Road Lot-04 tank in that window total 4,834 L — a ratio of
 * 1.008. Forty-six machines of every type (vibrating roller, tractor, crew cab,
 * skid steer, motor grader) all start within the same narrow band and climb
 * together, which no set of real odometers does.
 *
 * WHY BOTH TABLES: the import wrote the value twice — onto FuelIssue.meterReading
 * AND into a MeterReading row linked by meterReadingRecordId. Billing reads the
 * MeterReading table, so clearing the fuel rows alone would change nothing.
 *
 * WHAT IS LOST: nothing real. These readings never described a machine. The
 * affected bills fall back to the availability-prorated guaranteed minimum,
 * which is what they should have charged all along — RG-3187 is currently billed
 * 744 hours for a 31-day August, i.e. 24 hours a day for a month.
 *
 * The original values are written into the AuditLog entry in full, so the change
 * is reversible from the database itself and not only from the file backup.
 *
 *   npx tsx scripts/clean-lot04-totaliser.ts            # dry run
 *   npx tsx scripts/clean-lot04-totaliser.ts --apply
 */
import { prisma } from "../src/lib/db";
import { generateBillsForMonth } from "../src/lib/billing/generate";

const SOURCE = "Lot-04 fuel issue register (Jul–Aug 2026)";
const APPLY = process.argv.includes("--apply");

const rs = (c: number) => "Rs " + (c / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n1 = (v: number | null | undefined) => (v == null ? "—" : (Math.round(v * 10) / 10).toLocaleString("en-LK"));
const pad = (v: unknown, w: number) => String(v ?? "").padEnd(w);
const padL = (v: unknown, w: number) => String(v ?? "").padStart(w);

async function main() {
  const contaminated = await prisma.fuelIssue.findMany({
    where: { source: SOURCE, meterReading: { not: null }, voided: false },
    select: { id: true, assetId: true, meterReading: true, issueDate: true, litres: true, meterReadingRecordId: true },
  });

  if (contaminated.length === 0) {
    console.log(`No rows found for source ${JSON.stringify(SOURCE)} — already clean, or the source string has changed.`);
    await prisma.$disconnect();
    return;
  }

  const assetIds = [...new Set(contaminated.map((r) => r.assetId))];
  const readingIds = contaminated.map((r) => r.meterReadingRecordId).filter((x): x is string => !!x);

  // The tell, restated from the live data so the operator can see it before committing.
  const values = contaminated.map((r) => r.meterReading!).sort((a, b) => a - b);
  const span = values[values.length - 1] - values[0];
  const days = contaminated.map((r) => r.issueDate).sort((a, b) => a.getTime() - b.getTime());
  const litres = await prisma.fuelIssue.aggregate({
    where: { source: SOURCE, voided: false, issueDate: { gte: days[0], lte: days[days.length - 1] } },
    _sum: { litres: true },
  });
  const dispensed = litres._sum.litres ?? 0;

  console.log(`\n════ LOT-04 TOTALISER CLEAN-UP  (${APPLY ? "APPLY" : "DRY-RUN"}) ════`);
  console.log(`  source                      ${SOURCE}`);
  console.log(`  contaminated fuel rows      ${contaminated.length}   across ${assetIds.length} assets`);
  console.log(`  linked MeterReading rows    ${readingIds.length}`);
  console.log(`\n  ── the proof, re-derived now ──`);
  console.log(`  reading span                ${values[0].toLocaleString()} → ${values[values.length - 1].toLocaleString()} = ${span.toLocaleString()} units`);
  console.log(`  litres dispensed, same days ${dispensed.toLocaleString()} L`);
  console.log(`  ratio                       ${(span / dispensed).toFixed(3)}   (1.000 means it is a litre counter, not an odometer)`);
  if (Math.abs(span / dispensed - 1) > 0.1) {
    console.log(`\n✗ REFUSING: the ratio is not close to 1. These may be real meters — do not clean them.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // Bills that quote these readings, captured before anything changes.
  const before = await prisma.bill.findMany({
    where: { assetId: { in: assetIds } },
    select: {
      id: true, assetId: true, assetCode: true, periodKey: true, year: true, month: true, status: true,
      actualMeterUnits: true, billableUnits: true, minimumUnits: true, openingMeter: true, closingMeter: true,
      rentalAmountCents: true, grandTotalCents: true,
    },
    orderBy: [{ periodKey: "asc" }, { assetCode: "asc" }],
  });
  const quoting = before.filter((b) => b.openingMeter != null || b.closingMeter != null || (b.actualMeterUnits ?? 0) > 0);
  const meterDriven = quoting.filter((b) => b.billableUnits > b.minimumUnits);
  const issued = before.filter((b) => b.status !== "DRAFT");

  console.log(`\n  ── bills on these assets ──`);
  console.log(`  bills total                 ${before.length}`);
  console.log(`  quoting a meter figure      ${quoting.length}`);
  console.log(`  where the meter set the charge (billable > minimum)  ${meterDriven.length}`);
  console.log(`  NOT draft (already with a client)                    ${issued.length}${issued.length ? "  ⚠ " + issued.map((b) => b.assetCode + " " + b.periodKey).join(", ") : ""}`);

  if (meterDriven.length) {
    console.log(`\n  ── the bills where money actually moved ──`);
    console.log(`  ${pad("asset", 12)}${pad("period", 9)}${pad("status", 8)}${padL("actual", 12)}${padL("billable", 12)}${padL("minimum", 10)}${padL("rental", 16)}`);
    for (const b of meterDriven)
      console.log(`  ${pad(b.assetCode, 12)}${pad(b.periodKey, 9)}${pad(b.status, 8)}${padL(n1(b.actualMeterUnits), 12)}${padL(n1(b.billableUnits), 12)}${padL(n1(b.minimumUnits), 10)}${padL(rs(b.rentalAmountCents), 16)}`);
  }

  const periods = [...new Set(before.map((b) => `${b.year}-${b.month}`))].map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { year: y, month: m };
  });
  console.log(`\n  months to regenerate        ${periods.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`).join(", ") || "(none)"}`);

  if (!APPLY) {
    console.log(`\n(DRY-RUN) nothing written — re-run with --apply.`);
    await prisma.$disconnect();
    return;
  }

  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });

  await prisma.$transaction(async (tx) => {
    // Break the link first so the reading rows can go without leaving a dangling id.
    await tx.fuelIssue.updateMany({
      where: { id: { in: contaminated.map((r) => r.id) } },
      data: { meterReading: null, meterReadingRecordId: null },
    });
    const deleted = await tx.meterReading.deleteMany({ where: { id: { in: readingIds } } });

    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "FuelIssue",
        entityId: null,
        actorId: admin?.id ?? null,
        summary:
          `Cleared ${contaminated.length} meter readings imported from "${SOURCE}" across ${assetIds.length} assets, and deleted the ${deleted.count} MeterReading rows they created. ` +
          `The column held the EP I-Road Lot-04 tank's cumulative dispensed-litres counter, not vehicle odometers: the values span ${span.toLocaleString()} units over a window in which ${dispensed.toLocaleString()} L were issued from that tank (ratio ${(span / dispensed).toFixed(3)}). ` +
          `Affected bills fall back to the availability-prorated guaranteed minimum. Original values are recorded in this entry.`,
        metaJson: JSON.stringify({
          source: SOURCE,
          fuelRowsCleared: contaminated.length,
          meterRowsDeleted: deleted.count,
          assets: assetIds.length,
          span,
          dispensed,
          ratio: Number((span / dispensed).toFixed(4)),
          originals: contaminated.map((r) => ({
            fuelIssueId: r.id, assetId: r.assetId, meterReading: r.meterReading,
            meterReadingRecordId: r.meterReadingRecordId, issueDate: r.issueDate.toISOString(),
          })),
          billsBefore: quoting.map((b) => ({
            id: b.id, assetCode: b.assetCode, periodKey: b.periodKey, status: b.status,
            actualMeterUnits: b.actualMeterUnits, billableUnits: b.billableUnits, minimumUnits: b.minimumUnits,
            openingMeter: b.openingMeter, closingMeter: b.closingMeter,
            rentalAmountCents: b.rentalAmountCents, grandTotalCents: b.grandTotalCents,
          })),
        }),
      },
    });
  });

  // ── regenerate ────────────────────────────────────────────────────────────
  console.log(`\n  ── regenerating ──`);
  for (const p of periods) {
    const r = await generateBillsForMonth({
      year: p.year, month: p.month, assetIds, regenerate: true, actorId: admin?.id ?? null,
    });
    console.log(`  ${p.year}-${String(p.month).padStart(2, "0")}  regenerated ${r.regenerated}  created ${r.created}  noRate ${r.noRate}  errors ${r.errors.length}`);
    if (r.errors.length) for (const e of r.errors.slice(0, 5)) console.log(`      ! ${JSON.stringify(e)}`);
  }

  // ── reconciliation ────────────────────────────────────────────────────────
  const leftFuel = await prisma.fuelIssue.count({ where: { source: SOURCE, meterReading: { not: null } } });
  const leftReadings = await prisma.meterReading.count({ where: { id: { in: readingIds } } });
  const dangling = await prisma.fuelIssue.count({ where: { id: { in: contaminated.map((r) => r.id) }, meterReadingRecordId: { not: null } } });
  const litresAfter = await prisma.fuelIssue.aggregate({ where: { source: SOURCE, voided: false }, _sum: { litres: true } });

  const after = await prisma.bill.findMany({
    where: { id: { in: before.map((b) => b.id) } },
    select: { id: true, assetCode: true, periodKey: true, status: true, actualMeterUnits: true, billableUnits: true, minimumUnits: true, rentalAmountCents: true, grandTotalCents: true },
  });
  const afterById = new Map(after.map((b) => [b.id, b]));

  console.log(`\n── BEFORE / AFTER (bills that changed) ──`);
  console.log(`  ${pad("asset", 12)}${pad("period", 9)}${padL("billable was", 14)}${padL("now", 12)}${padL("grand was", 16)}${padL("now", 16)}${padL("change", 16)}`);
  let deltaTotal = 0;
  for (const b of before) {
    const a = afterById.get(b.id);
    if (!a || a.grandTotalCents === b.grandTotalCents) continue;
    const d = a.grandTotalCents - b.grandTotalCents;
    deltaTotal += d;
    console.log(`  ${pad(b.assetCode, 12)}${pad(b.periodKey, 9)}${padL(n1(b.billableUnits), 14)}${padL(n1(a.billableUnits), 12)}${padL(rs(b.grandTotalCents), 16)}${padL(rs(a.grandTotalCents), 16)}${padL((d > 0 ? "+" : "") + rs(d), 16)}`);
  }

  console.log(`\n── RECONCILIATION ──`);
  console.log(`  contaminated readings left    ${leftFuel}   (must be 0)`);
  console.log(`  orphaned MeterReading rows    ${leftReadings}   (must be 0)`);
  console.log(`  dangling meterReadingRecordId ${dangling}   (must be 0)`);
  console.log(`  litres on the source          ${(litresAfter._sum.litres ?? 0).toLocaleString()} L   (must be unchanged — we never touched litres)`);
  console.log(`  net change to billed value    ${(deltaTotal > 0 ? "+" : "") + rs(deltaTotal)}`);
  if (leftFuel || leftReadings || dangling) {
    console.log(`\n✗ reconciliation failed.`);
    process.exit(1);
  }
  console.log(`\n✓ DONE. The originals are in the AuditLog entry if this ever needs reversing.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
