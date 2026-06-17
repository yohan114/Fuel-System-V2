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
    where: {
      projectId: (await prisma.project.findUnique({ where: { code: "INGI" } }))?.id,
      year: 2026,
      month: { in: [3, 4] }
    },
    orderBy: [{ month: "asc" }, { assetCode: "asc" }]
  });
  console.log(`Found ${bills.length} bills:`);
  for (const b of bills) {
    console.log(`\nMonth: ${b.month} | Asset: ${b.assetCode}`);
    console.log(`  billingMode: ${b.billingMode}`);
    console.log(`  rateBasis: ${b.rateBasis}`);
    console.log(`  rateCents: ${b.rateCents}`);
    console.log(`  actualUnits: ${b.actualUnits}`);
    console.log(`  billableUnits: ${b.billableUnits}`);
    console.log(`  rentalAmountCents: ${b.rentalAmountCents}`);
    console.log(`  fuelLitres: ${b.fuelLitres}`);
    console.log(`  fuelCostCents: ${b.fuelCostCents}`);
    console.log(`  grandTotalCents: ${b.grandTotalCents}`);
    console.log(`  status: ${b.status}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);

