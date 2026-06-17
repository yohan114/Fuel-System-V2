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
  const assets = await prisma.asset.findMany({
    where: {
      code: { in: ["LB-06", "DT-74", "HCC-01", "HCC-03", "SL-10", "ZB-1521"] }
    },
    include: { project: true }
  });

  for (const a of assets) {
    console.log(`\n=========================================\nASSET: ${a.code} (reg: ${a.regNo}) | Project: ${a.project ? a.project.name + " (" + a.project.code + ")" : "NULL"}`);
    
    // Conditions
    const conds = await prisma.dailyCondition.findMany({
      where: {
        assetId: a.id,
        logDate: { gte: new Date("2026-03-01T00:00:00+05:30"), lt: new Date("2026-05-01T00:00:00+05:30") }
      }
    });
    console.log(`- Daily conditions: ${conds.length}`);
    if (conds.length > 0) {
      console.log(`  Dates: ${conds.map(c => c.logDate.toISOString().split("T")[0]).join(", ")}`);
    }

    // Fuel Issues
    const issues = await prisma.fuelIssue.findMany({
      where: {
        assetId: a.id,
        issueDate: { gte: new Date("2026-03-01T00:00:00+05:30"), lt: new Date("2026-05-01T00:00:00+05:30") }
      }
    });
    console.log(`- Fuel issues: ${issues.length}`);
    for (const i of issues) {
      console.log(`  * ${i.issueDate.toISOString().split("T")[0]} | Litres: ${i.litres} | Source: ${i.source}`);
    }

    // Readings
    const readings = await prisma.meterReading.findMany({
      where: {
        assetId: a.id,
        readingDate: { gte: new Date("2026-03-01T00:00:00+05:30"), lt: new Date("2026-05-01T00:00:00+05:30") }
      }
    });
    console.log(`- Meter readings: ${readings.length}`);
    for (const r of readings) {
      console.log(`  * ${r.readingDate.toISOString().split("T")[0]} | Value: ${r.value} | Source: ${r.source}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
