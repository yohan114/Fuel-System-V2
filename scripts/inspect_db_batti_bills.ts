import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const bills = await prisma.bill.findMany({
    where: { projectCode: "BATTI" },
    orderBy: [
      { periodKey: "asc" },
      { assetCode: "asc" }
    ]
  });

  console.log(`TOTAL BILLS FOR BATTI: ${bills.length}`);
  const periods = [...new Set(bills.map(b => b.periodKey))];
  console.log("Periods found:", periods);

  for (const period of periods) {
    const periodBills = bills.filter(b => b.periodKey === period);
    console.log(`\n--- Period: ${period} (Total ${periodBills.length} bills) ---`);
    console.log("Assets billed:", periodBills.map(b => b.assetCode).join(", "));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
