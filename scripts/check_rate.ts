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
  const asset = await prisma.asset.findUnique({
    where: { code: "DT-74" },
    include: { rentalRate: true }
  });
  console.log(`Asset:`, asset);
  if (asset) {
    console.log(`Rental rate card:`, asset.rentalRate);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
