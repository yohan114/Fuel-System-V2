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
  const lp = await prisma.asset.findFirst({ where: { code: "DT-74" } });
  if (!lp) {
    console.log("DT-74 not found!");
    return;
  }
  const bills = await prisma.bill.findMany({
    where: { assetId: lp.id },
    orderBy: [{ year: "asc" }, { month: "asc" }]
  });
  console.log(`Bills generated for DT-74 (LP-1577):`);
  for (const b of bills) {
    console.log(`  - Month: ${b.year}-${String(b.month).padStart(2, "0")} | Project: ${b.projectName} (${b.projectCode}) | Units: ${b.actualUnits} | Fuel: ${b.fuelLitres} L | Total: Rs. ${b.grandTotalCents / 100}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
