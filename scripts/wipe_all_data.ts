/**
 * FULL DATA RESET — wipes all operational data.
 * KEEPS: ADMIN users and Settings (so the app stays usable / you can still log in).
 * Deletes everything else: assets, projects, categories, rate cards, fuel prices,
 * bulk tanks, all transactions (fuel issues/requests, meter readings, daily conditions),
 * bills + line items, audit logs, and all non-ADMIN users.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const before = {
    users: await prisma.user.count(),
    assets: await prisma.asset.count(),
    projects: await prisma.project.count(),
    fuelIssues: await prisma.fuelIssue.count(),
    meterReadings: await prisma.meterReading.count(),
    dailyConditions: await prisma.dailyCondition.count(),
    bills: await prisma.bill.count(),
  };
  console.log("BEFORE:", JSON.stringify(before));

  // 1. Detach user references to things we're about to delete
  await prisma.user.updateMany({ data: { projectId: null, bulkTankId: null, createdById: null } });

  // 2. Children → parents
  await prisma.billLineItem.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.fuelIssue.deleteMany();
  await prisma.meterReading.deleteMany();
  await prisma.dailyCondition.deleteMany();
  await prisma.fuelRequest.deleteMany();
  await prisma.bulkRequest.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.assetAssignment.deleteMany();
  await prisma.rentalRate.deleteMany();
  await prisma.fuelPrice.deleteMany();
  await prisma.bulkTank.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.category.deleteMany();
  await prisma.project.deleteMany();

  // 3. Delete all non-ADMIN users (keep admins for login)
  const delUsers = await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });

  const after = {
    users: await prisma.user.count(),
    adminUsers: await prisma.user.count({ where: { role: "ADMIN" } }),
    assets: await prisma.asset.count(),
    projects: await prisma.project.count(),
    fuelIssues: await prisma.fuelIssue.count(),
    meterReadings: await prisma.meterReading.count(),
    dailyConditions: await prisma.dailyCondition.count(),
    bills: await prisma.bill.count(),
    settings: await prisma.setting.count(),
  };
  console.log(`Deleted ${delUsers.count} non-admin user(s).`);
  console.log("AFTER:", JSON.stringify(after));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
