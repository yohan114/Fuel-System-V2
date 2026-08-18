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
  console.log("=== VERIFYING CEP-03 ABC PROJECT DATA ===");

  const project = await prisma.project.findUnique({
    where: { code: "CEP-03-ABC" },
    include: {
      assets: true,
      users: true
    }
  });

  if (!project) {
    console.error("Project CEP-03-ABC not found in database!");
    return;
  }

  console.log(`Project Name: ${project.name}`);
  console.log(`Project Code: ${project.code}`);
  console.log(`Users count : ${project.users.length}`);
  console.log(`  Usernames : ${project.users.map(u => u.username).join(", ")}`);
  console.log(`Assets count: ${project.assets.length}`);

  const fuelIssues = await prisma.fuelIssue.findMany({
    where: { source: "CEP-03-ABC" }
  });
  console.log(`Fuel Issues count: ${fuelIssues.length}`);
  const totalLitres = fuelIssues.reduce((sum, fi) => sum + fi.litres, 0);
  const totalCost = fuelIssues.reduce((sum, fi) => sum + fi.totalCost, 0);
  console.log(`  Total Litres: ${totalLitres.toFixed(1)} L`);
  console.log(`  Total Cost  : Rs. ${(totalCost / 100).toLocaleString()}`);

  const startReadings = await prisma.meterReading.count({
    where: { source: "CEP-03-ABC_START" }
  });
  const endReadings = await prisma.meterReading.count({
    where: { source: "CEP-03-ABC_END" }
  });
  console.log(`Meter Readings (START/END Pairs): ${startReadings} / ${endReadings}`);

  const bills = await prisma.bill.findMany({
    where: { projectCode: "CEP-03-ABC" },
    include: {
      lineItems: true
    },
    orderBy: [
      { assetCode: "asc" },
      { periodKey: "asc" }
    ]
  });

  console.log(`\n=== GENERATED BILLS (Count: ${bills.length}) ===`);
  if (bills.length === 0) {
    console.log("No bills found. Run the billing seed script first!");
  } else {
    for (const bill of bills) {
      console.log(`\nBill ID: ${bill.id}`);
      console.log(`  Asset: ${bill.assetCode} (${bill.assetRegNo}) | Period: ${bill.periodKey}`);
      console.log(`  Mode: ${bill.billingMode} (${bill.rateBasis}) | Rate: Rs. ${(bill.rateCents / 100).toLocaleString()}`);
      console.log(`  Usage: ${bill.actualUnits} ${bill.billingMode === "hourly" ? "hrs" : "kms"} (Billable: ${bill.billableUnits})`);
      console.log(`  Subtotal: Rs. ${(bill.subtotalCents / 100).toLocaleString()}`);
      console.log(`  SSCL: Rs. ${(bill.ssclCents / 100).toLocaleString()} | VAT: Rs. ${(bill.vatCents / 100).toLocaleString()}`);
      console.log(`  Grand Total: Rs. ${(bill.grandTotalCents / 100).toLocaleString()}`);
      console.log(`  Line Items:`);
      for (const item of bill.lineItems) {
        console.log(`    - [${item.kind}] ${item.description}: ${item.quantity} × Rs. ${(item.unitRateCents / 100).toLocaleString()} = Rs. ${(item.amountCents / 100).toLocaleString()}`);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
