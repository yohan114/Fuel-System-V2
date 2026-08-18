import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function getProjectCode() {
  const asset = await prisma.asset.findFirst({
    where: { code: "DT-74" },
    include: { project: true }
  });
  return asset?.project?.code || "NULL";
}

async function main() {
  process.env.UPLOADS_DIR = "temp-uploads";

  console.log("Wiping...");
  execSync("npx tsx scripts/wipe_all_data.ts", { stdio: "ignore" });
  console.log("After wipe:", await getProjectCode());

  console.log("Importing fuel prices...");
  execSync("npx tsx scripts/import_fuel_prices.ts", { stdio: "ignore" });

  console.log("Importing machines...");
  execSync("npx tsx scripts/import_machines.ts", { stdio: "ignore" });
  console.log("After machines:", await getProjectCode());

  console.log("Importing site summaries...");
  execSync("npx tsx scripts/import_site_summaries.ts", { stdio: "ignore" });
  console.log("After site summaries:", await getProjectCode());

  console.log("Importing CEP running...");
  execSync("npx tsx scripts/import_cep_running.ts", { stdio: "ignore" });
  console.log("After CEP running:", await getProjectCode());

  console.log("Importing CEP-03 ABC...");
  execSync("npx tsx scripts/import_cep_abc.ts", { stdio: "ignore" });
  console.log("After CEP-03 ABC:", await getProjectCode());

  console.log("Running fix_pv6889...");
  execSync("npx tsx scripts/fix_pv6889.ts", { stdio: "ignore" });
  console.log("After fix:", await getProjectCode());

  await prisma.$disconnect();
}

main().catch(console.error);
