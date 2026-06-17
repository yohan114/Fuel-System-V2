import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { generateBillsForMonth } from "../src/lib/billing/generate";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Starting billing system database seed...");

  // Resolve an admin actor to log the bill generation
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" }
  });
  if (!admin) {
    throw new Error("No admin user found. Please seed basic setup first.");
  }
  console.log(`Using admin actor: ${admin.name} (${admin.id})`);

  // Target periods
  const periods = [
    // 2025 Months
    { year: 2025, month: 1 },
    { year: 2025, month: 5 },
    { year: 2025, month: 6 },
    { year: 2025, month: 7 },
    { year: 2025, month: 8 },
    { year: 2025, month: 9 },
    { year: 2025, month: 10 },
    { year: 2025, month: 11 },
    { year: 2025, month: 12 },
    // 2026 Months
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
    { year: 2026, month: 3 },
    { year: 2026, month: 4 },
    { year: 2026, month: 5 },
    { year: 2026, month: 6 }
  ];

  for (const p of periods) {
    console.log(`Generating bills for ${p.year}-${String(p.month).padStart(2, "0")}...`);
    const res = await generateBillsForMonth({
      year: p.year,
      month: p.month,
      regenerate: true,
      actorId: admin.id
    });
    console.log(`  Outcome: Created=${res.created}, Regenerated=${res.regenerated}, NoRate=${res.noRate}, Errors=${res.errors.length}`);
  }

  // Get total count of bills in DB
  const billCount = await prisma.bill.count();
  const lineItemCount = await prisma.billLineItem.count();
  console.log(`\nBilling seed complete! Total bills in database: ${billCount} (with ${lineItemCount} line items).`);
}

main()
  .catch((e) => {
    console.error("Billing seed script failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
