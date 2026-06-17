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
  const hex18 = await prisma.asset.findUnique({
    where: { code: "HEX-18" },
    include: { project: true }
  });
  if (!hex18) {
    console.log("HEX-18 not found!");
    return;
  }
  console.log(`HEX-18 details: Code: ${hex18.code} | Project: ${hex18.project ? hex18.project.name : "NULL"}`);

  // dailyConditions for HEX-18 in March 2026
  const conds = await prisma.dailyCondition.findMany({
    where: {
      assetId: hex18.id,
      logDate: {
        gte: new Date("2026-03-01T00:00:00+05:30"),
        lt: new Date("2026-04-01T00:00:00+05:30")
      }
    }
  });
  console.log(`\nDaily conditions in March 2026: ${conds.length}`);
  for (const c of conds) {
    console.log(`  - ${c.logDate.toISOString().split("T")[0]} | Status: ${c.status}`);
  }

  // fuelIssues for HEX-18 in March 2026
  const issues = await prisma.fuelIssue.findMany({
    where: {
      assetId: hex18.id,
      issueDate: {
        gte: new Date("2026-03-01T00:00:00+05:30"),
        lt: new Date("2026-04-01T00:00:00+05:30")
      }
    }
  });
  console.log(`\nFuel issues in March 2026: ${issues.length}`);
  for (const i of issues) {
    console.log(`  - ${i.issueDate.toISOString().split("T")[0]} | Litres: ${i.litres} | Source: ${i.source}`);
  }

  // meterReadings for HEX-18 in March 2026
  const readings = await prisma.meterReading.findMany({
    where: {
      assetId: hex18.id,
      readingDate: {
        gte: new Date("2026-03-01T00:00:00+05:30"),
        lt: new Date("2026-04-01T00:00:00+05:30")
      }
    }
  });
  console.log(`\nMeter readings in March 2026: ${readings.length}`);
  for (const r of readings) {
    console.log(`  - ${r.readingDate.toISOString().split("T")[0]} | Value: ${r.value} | Source: ${r.source}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
