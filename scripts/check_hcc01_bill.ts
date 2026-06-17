import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const bills = await prisma.bill.findMany({
    where: { assetCode: "HCC-01", year: 2026, month: 4 },
  });
  console.log("Bills for HCC-01 in 2026-04:", bills);
  
  // Let's also check if HCC-01 had activity in April 2026 in activeAssetIds
  const start = new Date("2026-03-31T18:30:00.000Z");
  const end = new Date("2026-04-30T18:29:59.999Z");
  const asset = await prisma.asset.findUnique({ where: { code: "HCC-01" } });
  if (asset) {
    const cond = await prisma.dailyCondition.count({ where: { assetId: asset.id, logDate: { gte: start, lte: end } } });
    const fuel = await prisma.fuelIssue.count({ where: { assetId: asset.id, issueDate: { gte: start, lte: end } } });
    const read = await prisma.meterReading.count({ where: { assetId: asset.id, readingDate: { gte: start, lte: end } } });
    console.log(`Activity counts for HCC-01 in April 2026: cond=${cond}, fuel=${fuel}, read=${read}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
