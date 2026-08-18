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
  try {
    const asset = await prisma.asset.findFirst({
      where: { code: 'DT-47' },
      include: {
        rentalRate: true,
        assignments: true,
      }
    });
    if (!asset) {
      console.log('Asset DT-47 not found!');
      return;
    }
    console.log('ASSET:', JSON.stringify(asset, null, 2));

    const bills = await prisma.bill.findMany({
      where: { assetId: asset.id },
      orderBy: { periodKey: 'asc' },
      include: {
        lineItems: true
      }
    });
    console.log('BILLS count:', bills.length);
    for (const b of bills) {
      console.log(`\nBill Period: ${b.periodKey}`);
      console.log(`Status: ${b.status}`);
      console.log(`Billing Mode: ${b.billingMode}`);
      console.log(`Actual Units: ${b.actualUnits}`);
      console.log(`Billable Units: ${b.billableUnits}`);
      console.log(`Fuel Litres: ${b.fuelLitres}`);
      console.log(`Opening Meter: ${b.openingMeter}`);
      console.log(`Closing Meter: ${b.closingMeter}`);
      console.log(`Grand Total Cents: ${b.grandTotalCents}`);
      console.log(`Derived From Fuel: ${b.derivedFromFuel}`);
      console.log('Line Items:');
      for (const li of b.lineItems) {
        console.log(` - ${li.kind}: ${li.description} | Qty: ${li.quantity} | Amount: Rs. ${li.amountCents / 100}`);
      }
    }

    const readings = await prisma.meterReading.findMany({
      where: { assetId: asset.id },
      orderBy: { readingDate: 'asc' }
    });
    console.log('\nMETER READINGS count:', readings.length);
    for (const r of readings) {
      console.log(`Date: ${r.readingDate.toISOString()} | Value: ${r.value} | Type: ${r.readingType} | Source: ${r.source}`);
    }

    const fuelIssues = await prisma.fuelIssue.findMany({
      where: { assetId: asset.id },
      orderBy: { issueDate: 'asc' }
    });
    console.log('\nFUEL ISSUES count:', fuelIssues.length);
    for (const f of fuelIssues) {
      console.log(`Date: ${f.issueDate.toISOString()} | Litres: ${f.litres} | Meter: ${f.meterReading} | Source: ${f.source} | Voided: ${f.voided}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
