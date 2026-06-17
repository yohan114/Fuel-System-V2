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
  const codes = ["LP-1577", "PA-6399", "PA-4879", "SL-10", "ZB-1521", "ZA-0447"];
  for (const c of codes) {
    const a = await prisma.asset.findFirst({
      where: {
        OR: [
          { code: c },
          { regNo: c }
        ]
      },
      include: {
        project: true
      }
    });
    if (a) {
      console.log(`Asset: ${a.code} | RegNo: ${a.regNo} | Project: ${a.project ? a.project.name + " (" + a.project.code + ")" : "NULL"} | MeterType: ${a.meterType} | TypeLabel: ${a.typeLabel}`);
    } else {
      console.log(`Asset ${c} not found!`);
    }
  }

  // Also let's print all fuel issues for LP-1577 if any
  const lp = await prisma.asset.findFirst({ where: { OR: [{ code: "LP-1577" }, { regNo: "LP-1577" }] } });
  if (lp) {
    const issues = await prisma.fuelIssue.findMany({
      where: { assetId: lp.id },
      include: { asset: true },
      orderBy: { issueDate: "asc" }
    });
    console.log(`\nFuel Issues for LP-1577 (${issues.length}):`);
    for (const fi of issues) {
      console.log(`  - ${fi.issueDate.toISOString().split("T")[0]} | Source: ${fi.source} | Litres: ${fi.litres}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
