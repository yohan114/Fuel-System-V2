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
  const project = await prisma.project.findUnique({ where: { code: "INGI" } });
  if (!project) {
    console.log("INGI project not found!");
    return;
  }
  console.log(`Found Project: ${project.name} (${project.code})`);

  // Find all assets assigned to INGI
  const assets = await prisma.asset.findMany({
    where: { projectId: project.id },
    select: { id: true, code: true, regNo: true, meterType: true, typeLabel: true }
  });
  console.log(`\nAssets assigned to INGI (${assets.length}):`);
  for (const a of assets) {
    console.log(`  - ${a.code} / ${a.regNo} (${a.typeLabel}, ${a.meterType})`);
  }

  // Find all fuel issues for source = 'INGI' or project
  const fuelIssues = await prisma.fuelIssue.findMany({
    where: { source: "INGI" },
    include: { asset: true },
    orderBy: { issueDate: "asc" }
  });
  console.log(`\nFuel Issues for source INGI (${fuelIssues.length}):`);
  for (const fi of fuelIssues) {
    const dateStr = fi.issueDate.toISOString().split("T")[0];
    console.log(`  - ${dateStr} | Asset: ${fi.asset.code} | Litres: ${fi.litres} | Cost: ${fi.totalCost}`);
  }

  // Find all meter readings for INGI assets in March/April 2026
  const readings = await prisma.meterReading.findMany({
    where: {
      assetId: { in: assets.map(a => a.id) },
      readingDate: {
        gte: new Date("2026-03-01T00:00:00+05:30"),
        lt: new Date("2026-05-01T00:00:00+05:30")
      }
    },
    include: { asset: true },
    orderBy: [{ assetId: "asc" }, { readingDate: "asc" }]
  });
  console.log(`\nMeter readings for INGI assets in March & April 2026 (${readings.length}):`);
  for (const r of readings) {
    const dateStr = r.readingDate.toISOString().split("T")[0];
    console.log(`  - ${dateStr} | Asset: ${r.asset.code} | Value: ${r.value} | Source: ${r.source}`);
  }

  // Find bills for INGI in March/April 2026
  const bills = await prisma.bill.findMany({
    where: {
      projectId: project.id,
      periodStart: {
        gte: new Date("2026-03-01T00:00:00+05:30"),
        lt: new Date("2026-05-01T00:00:00+05:30")
      }
    },
    include: { asset: true },
    orderBy: [{ periodStart: "asc" }, { asset: { code: "asc" } }]
  });
  console.log(`\nBills generated for INGI in March & April 2026 (${bills.length}):`);
  for (const b of bills) {
    console.log(`  - Period: ${b.periodStart.toISOString().split("T")[0]} to ${b.periodEnd.toISOString().split("T")[0]} | Asset: ${b.asset.code} | Days/Hours: ${b.actualMeterUnits} | Amount: ${b.rentalAmountCents / 100}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
