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
  if (!project) return;

  const bills = await prisma.bill.findMany({
    where: { projectId: project.id },
    select: {
      year: true,
      month: true,
      assetCode: true,
      actualUnits: true,
      fuelLitres: true,
      grandTotalCents: true,
    },
    orderBy: [
      { year: "asc" },
      { month: "asc" },
      { assetCode: "asc" }
    ]
  });

  const grouped: Record<string, string[]> = {};
  for (const b of bills) {
    const key = `${b.year}-${String(b.month).padStart(2, "0")}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(`${b.assetCode} (u:${b.actualUnits}, f:${b.fuelLitres}, Rs:${b.grandTotalCents / 100})`);
  }

  console.log("ALL GENERATED INGI BILLS BY MONTH:");
  for (const [month, list] of Object.entries(grouped)) {
    console.log(`\nMonth: ${month}`);
    for (const item of list) {
      console.log(`  - ${item}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
