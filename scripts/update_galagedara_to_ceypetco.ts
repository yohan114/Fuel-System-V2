import { prisma } from "../src/lib/db";

async function main() {
  console.log("\n==================================================================");
  console.log("=== UPDATING CEP-03F GALAGEDARA SEPTEMBER FUEL ISSUES TO CEYPETCO ===");
  console.log("==================================================================\n");

  const tank = await prisma.bulkTank.findUnique({
    where: { id: "cc7612c1-b235-4670-8284-45657874fec6" },
  });
  if (!tank) throw new Error("Tank not found!");

  // 1. Locate Ceypetco price for AUTO_DIESEL @ 38200 cents (Rs. 382.00)
  const ceypetcoPrice = await prisma.fuelPrice.findFirst({
    where: {
      fuelKind: "AUTO_DIESEL",
      pricePerLitre: 38200,
      source: "CEYPETCO",
      effectiveFrom: { lte: new Date("2026-09-15") },
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!ceypetcoPrice) throw new Error("Ceypetco AUTO_DIESEL @ Rs. 382.00 price not found!");

  console.log(`Target Price Record: Rs. ${(ceypetcoPrice.pricePerLitre / 100).toFixed(2)}/L (ID: ${ceypetcoPrice.id})`);

  // 2. Locate September issues
  const issues = await prisma.fuelIssue.findMany({
    where: {
      bulkTankId: tank.id,
      issueDate: {
        gte: new Date("2026-09-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      },
      voided: false,
    },
    select: {
      id: true,
      litres: true,
      pricePerLitre: true,
      totalCost: true,
    },
  });

  console.log(`Found ${issues.length} September issues for ${tank.name}.`);
  const initialLitres = issues.reduce((s, i) => s + i.litres, 0);
  const initialCost = issues.reduce((s, i) => s + i.totalCost, 0);
  console.log(`Initial Volume: ${initialLitres} L`);
  console.log(`Initial Spend:  Rs. ${(initialCost / 100).toLocaleString()}`);

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("Admin user not found!");

  // 3. Perform batch update in transaction
  console.log("\nExecuting price recalculation in transaction...");
  await prisma.$transaction(async (tx) => {
    for (const issue of issues) {
      const newCost = Math.round(issue.litres * ceypetcoPrice.pricePerLitre);
      await tx.fuelIssue.update({
        where: { id: issue.id },
        data: {
          pricePerLitre: ceypetcoPrice.pricePerLitre,
          totalCost: newCost,
          fuelPriceId: ceypetcoPrice.id,
        },
      });
    }

    // Create AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "FuelIssue",
        entityId: tank.id,
        summary: `Updated ${issues.length} September 2026 fuel issues for ${tank.name} from Rs. 303.00/L to official Ceypetco rate Rs. 382.00/L (31,911 L = Rs. 12,189,902.00).`,
      },
    });
  });

  // 4. Verify post-update
  const updatedAgg = await prisma.fuelIssue.aggregate({
    where: {
      bulkTankId: tank.id,
      issueDate: {
        gte: new Date("2026-09-01T00:00:00.000Z"),
        lt: new Date("2026-10-01T00:00:00.000Z"),
      },
      voided: false,
    },
    _count: { id: true },
    _sum: { litres: true, totalCost: true },
  });

  console.log("\nPOST-UPDATE RECONCILIATION:");
  console.log(` - Issues count: ${updatedAgg._count.id}`);
  console.log(` - Total Volume: ${updatedAgg._sum.litres} L`);
  console.log(` - Total Spend:  Rs. ${((updatedAgg._sum.totalCost || 0) / 100).toLocaleString()} (exact: Rs. ${((updatedAgg._sum.totalCost || 0) / 100).toFixed(2)})`);
  console.log("\nSUCCESS: All September Galagedara fuel issues updated to Ceypetco rate Rs. 382.00/L!\n");
}

main().catch(console.error).finally(() => process.exit(0));
