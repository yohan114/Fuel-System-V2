import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const assets = await prisma.asset.findMany({
    where: {
      code: {
        in: ["MG-06", "MG-15"]
      }
    },
    include: {
      project: true,
      category: true,
      fuelIssues: {
        orderBy: { issueDate: "asc" }
      },
      meterReadings: {
        orderBy: { readingDate: "asc" }
      }
    }
  });

  console.log("MG-06 & MG-15 ASSETS IN DB:");
  for (const a of assets) {
    console.log(`\n----------------------------------------`);
    console.log(`Code: ${a.code} | Project: ${a.project ? a.project.name : 'NONE'} (${a.project ? a.project.code : ''})`);
    console.log(`Total Fuel Issues: ${a.fuelIssues.length}`);
    if (a.fuelIssues.length > 0) {
      console.log(`  First Issue: ${a.fuelIssues[0].issueDate.toISOString()} | Source: ${a.fuelIssues[0].source}`);
      console.log(`  Last Issue: ${a.fuelIssues[a.fuelIssues.length - 1].issueDate.toISOString()} | Source: ${a.fuelIssues[a.fuelIssues.length - 1].source}`);
    }
    console.log(`Total Meter Readings: ${a.meterReadings.length}`);
    if (a.meterReadings.length > 0) {
      console.log(`  First Reading: ${a.meterReadings[0].readingDate.toISOString()} | Source: ${a.meterReadings[0].source} | Value: ${a.meterReadings[0].value}`);
      console.log(`  Last Reading: ${a.meterReadings[a.meterReadings.length - 1].readingDate.toISOString()} | Source: ${a.meterReadings[a.meterReadings.length - 1].source} | Value: ${a.meterReadings[a.meterReadings.length - 1].value}`);
    }

    const bills = await prisma.bill.findMany({
      where: { assetId: a.id },
      orderBy: { periodKey: "asc" }
    });
    console.log(`Total Bills: ${bills.length}`);
    for (const b of bills) {
      console.log(`  Bill Period: ${b.periodKey} | Project: ${b.projectName} (${b.projectCode})`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
