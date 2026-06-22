// Smoke test for the Fuel + Service merge (phase 1).
// Run: DATABASE_URL="file:./data/app.db" npx tsx scripts/verify_service_merge.ts
import { prisma } from "../src/lib/db";
import { computeServiceTotals } from "../src/lib/service/charge";
import { DEFAULT_SERVICE_RATES } from "../src/lib/service/defaults";
import { computeServiceStatus } from "../src/lib/service/compute";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) console.log("  ✅", msg);
  else {
    console.error("  ❌", msg);
    failures++;
  }
}

async function main() {
  console.log("1) Charge math (mirrors the Service Record system examples):");
  const t1 = computeServiceTotals(800_000, DEFAULT_SERVICE_RATES); // Rs 8,000
  assert(t1.labourRatePct === 20 && t1.grandTotalCents === 1_000_000, `parts 8,000 → total ${t1.grandTotalCents / 100} (expect 10,000 @20%)`);
  const t2 = computeServiceTotals(2_500_000, DEFAULT_SERVICE_RATES); // Rs 25,000
  assert(t2.labourRatePct === 15 && t2.grandTotalCents === 3_000_000, `parts 25,000 → total ${t2.grandTotalCents / 100} (expect 30,000 @15%)`);

  console.log("2) Planner is backed by detailed records:");
  const tag = "ZZ" + Date.now().toString().slice(-7);
  const cat = await prisma.category.create({
    data: { code: tag, name: "Verify Cat", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  });
  const user = await prisma.user.create({
    data: { username: "verify_" + tag, name: "Verify User", passwordHash: "x", role: "ADMIN" },
  });
  const asset = await prisma.asset.create({ data: { code: "HEX-" + tag, meterType: "HOURS", categoryId: cat.id } });
  await prisma.meterReading.create({
    data: { assetId: asset.id, value: 1000, readingType: "HOURS", readingDate: new Date("2026-06-01"), source: "MANUAL", recordedById: user.id },
  });

  try {
    const before = await computeServiceStatus(asset.id, new Date("2026-06-20"));
    assert(before?.lastServiceDate == null, `no last service before logging (lastServiceDate=${before?.lastServiceDate ?? "null"})`);

    const totals = computeServiceTotals(800_000, DEFAULT_SERVICE_RATES);
    const rec = await prisma.serviceRecord.create({
      data: {
        assetId: asset.id,
        serviceDate: new Date("2026-06-15"),
        meterAtService: 990,
        meterType: "HOURS",
        serviceType: "500HR",
        jobNo: "JOB-" + tag,
        siteLocation: "Verify Site",
        partsSubtotalCents: totals.partsSubtotalCents,
        labourRatePct: totals.labourRatePct,
        labourChargeCents: totals.labourChargeCents,
        sundryRatePct: totals.sundryRatePct,
        sundryAmountCents: totals.sundryAmountCents,
        grandTotalCents: totals.grandTotalCents,
        costCents: totals.grandTotalCents,
        recordedById: user.id,
        oils: { create: [{ oilName: "Engine Oil", oilType: "15W40-CI/04", quantity: 12, priceCents: 800_000 }] },
        filters: { create: [{ filterCategory: "Air Filter", filterNo: "AF-1", quantity: 1, priceCents: 0 }] },
      },
      include: { oils: true, filters: true },
    });
    assert(rec.oils.length === 1 && rec.filters.length === 1, "oils + filters children persisted with the record");
    assert(rec.grandTotalCents === 1_000_000, `record grand total stored (Rs ${rec.grandTotalCents / 100})`);

    const after = await computeServiceStatus(asset.id, new Date("2026-06-20"));
    assert(after?.lastServiceDate?.toISOString().slice(0, 10) === "2026-06-15", `planner now reads last service date (${after?.lastServiceDate?.toISOString().slice(0, 10)})`);
    assert(after?.usedSince != null && after.usedSince <= 20, `countdown reset after service: usedSince=${after?.usedSince} of ${after?.intervalValue} (remaining ${after?.remaining})`);
    console.log(`     planner: state=${after?.state}, usedSince=${after?.usedSince}, remaining=${after?.remaining}, intervalSource=${after?.intervalSource}`);
  } finally {
    await prisma.serviceRecord.deleteMany({ where: { assetId: asset.id } });
    await prisma.meterReading.deleteMany({ where: { assetId: asset.id } });
    await prisma.asset.delete({ where: { id: asset.id } });
    await prisma.category.delete({ where: { id: cat.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("  (cleaned up test data)");
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
