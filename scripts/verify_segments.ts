import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { resolvePeriod } from "../src/lib/billing/period";
import { generateBillForAsset } from "../src/lib/billing/generate";

// End-to-end check of per-site split billing. Creates a throwaway scenario —
// one excavator that works Site A for 10 days then Site B for 20 days of a test
// month, with readings + fuel at each — generates its bill, prints the per-site
// line items, then deletes everything it created.
//
//   npx tsx scripts/verify_segments.ts

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 0, 0, 0, 0);
const rs = (cents: number) => "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 });

async function main() {
  const cat = await prisma.category.create({
    data: { code: `ZZTEST`, name: "Test Excavator", defaultMeterType: "HOURS", fleetGroup: "MACHINERY_GENSET" },
  });
  const projA = await prisma.project.create({ data: { name: "ZZ Site A", code: "ZZA" } });
  const projB = await prisma.project.create({ data: { name: "ZZ Site B", code: "ZZB" } });
  const asset = await prisma.asset.create({
    data: { code: "ZZ-HEX-1", categoryId: cat.id, meterType: "HOURS", status: "ACTIVE", projectId: projB.id },
  });
  await prisma.rentalRate.create({
    data: { assetId: asset.id, equipType: "FLEET", hrWCents: 100_000 }, // Rs 1000/hr
  });

  // Assignments: A = Sep 1-10 (10 days), B = Sep 11-onward (clips to 20 days).
  await prisma.assetAssignment.create({ data: { assetId: asset.id, projectId: projA.id, startDate: d(2026, 9, 1), endDate: d(2026, 9, 10) } });
  await prisma.assetAssignment.create({ data: { assetId: asset.id, projectId: projB.id, startDate: d(2026, 9, 11), endDate: null } });

  // Readings: anchor before month, mid (end of A), end of month.
  const u = (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ??
    (await prisma.user.create({ data: { username: "zz_seed", name: "zz", passwordHash: "x", role: "ADMIN" } }));
  for (const [day, val] of [[d(2026, 8, 28), 1000], [d(2026, 9, 10), 1100], [d(2026, 9, 30), 1300]] as [Date, number][]) {
    await prisma.meterReading.create({ data: { assetId: asset.id, value: val, readingType: "HOURS", readingDate: day, source: "MANUAL", recordedById: u.id } });
  }
  // Fuel: 50 L in A (source BADALGAMA, to prove fuel follows the vehicle), 100 L in B.
  await prisma.fuelIssue.create({ data: { assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: 50, pricePerLitre: 30_000, totalCost: 1_500_000, source: "BADALGAMA", issueDate: d(2026, 9, 5), issuedById: u.id } });
  await prisma.fuelIssue.create({ data: { assetId: asset.id, fuelKind: "AUTO_DIESEL", litres: 100, pricePerLitre: 30_000, totalCost: 3_000_000, source: "ZZB", issueDate: d(2026, 9, 20), issuedById: u.id } });

  const period = resolvePeriod(2026, 9);
  const res = await generateBillForAsset(asset.id, period, { regenerate: true, actorId: u.id });
  const bill = await prisma.bill.findUnique({ where: { id: res.billId! }, include: { lineItems: true } });

  console.log("\n=== BILL (status " + res.status + ") ===");
  console.log(`Header site: ${bill!.projectName} (${bill!.projectCode})  notes: ${bill!.notes}`);
  console.log(`actualUnits=${bill!.actualUnits}  minimumUnits=${bill!.minimumUnits}  billableUnits=${bill!.billableUnits}  fuelLitres=${bill!.fuelLitres}`);
  console.log(`rental=${rs(bill!.rentalAmountCents)}  fuel=${rs(bill!.fuelCostCents)}  subtotal=${rs(bill!.subtotalCents)}  grand=${rs(bill!.grandTotalCents)}`);
  console.log("--- line items ---");
  for (const li of bill!.lineItems.sort((a, b) => a.kind.localeCompare(b.kind))) {
    console.log(`  [${li.kind}] ${li.projectName ?? "—"}: ${li.quantity} ${li.unit} @ ${rs(li.unitRateCents)} = ${rs(li.amountCents)}  | ${li.description}`);
  }
  console.log("\nExpected: A rental 100hr=Rs1,000,000 · B rental 200hr=Rs2,000,000 · fuel 50L+100L · 2 sites split.");

  // Cleanup
  await prisma.billLineItem.deleteMany({ where: { billId: bill!.id } });
  await prisma.bill.deleteMany({ where: { assetId: asset.id } });
  await prisma.fuelIssue.deleteMany({ where: { assetId: asset.id } });
  await prisma.meterReading.deleteMany({ where: { assetId: asset.id } });
  await prisma.assetAssignment.deleteMany({ where: { assetId: asset.id } });
  await prisma.rentalRate.deleteMany({ where: { assetId: asset.id } });
  await prisma.asset.delete({ where: { id: asset.id } });
  await prisma.project.deleteMany({ where: { id: { in: [projA.id, projB.id] } } });
  await prisma.category.delete({ where: { id: cat.id } });
  if (u.username === "zz_seed") await prisma.user.delete({ where: { id: u.id } });
  console.log("\nCleaned up test data.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
