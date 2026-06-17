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

async function main() {
  console.log("Wiping and running import_site_summaries only...");
  execSync("npx tsx scripts/wipe_all_data.ts", { stdio: "ignore" });
  execSync("npx tsx scripts/import_fuel_prices.ts", { stdio: "ignore" });
  execSync("npx tsx scripts/import_machines.ts", { stdio: "ignore" });
  execSync("npx tsx scripts/import_fuel_cons.ts", { stdio: "ignore" });
  
  process.env.UPLOADS_DIR = "temp-uploads";
  execSync("npx tsx scripts/import_site_summaries.ts", { stdio: "ignore" });

  const initialIssues = await prisma.fuelIssue.findMany({
    select: { id: true, asset: { select: { code: true } }, litres: true, issueDate: true, source: true }
  });
  console.log(`Summary fuel issues created: ${initialIssues.length}`);

  console.log("Running import_cep_running...");
  execSync("npx tsx scripts/import_cep_running.ts", { stdio: "ignore" });

  const afterRunning = await prisma.fuelIssue.findMany({
    select: { id: true, asset: { select: { code: true } }, litres: true, issueDate: true, source: true }
  });

  const remainingSummaryIssues = afterRunning.filter(i => ["INGI", "GB", "KB", "BATTI"].includes(i.source));
  console.log(`Summary fuel issues remaining: ${remainingSummaryIssues.length}`);

  const missing = initialIssues.filter(ii => !afterRunning.some(ar => ar.asset.code === ii.asset.code && ar.source === ii.source && ar.issueDate.getTime() === ii.issueDate.getTime()));
  console.log(`\nDeleted Summary Fuel Issues (${missing.length}):`);
  for (const m of missing) {
    console.log(`  - Asset: ${m.asset.code} | Date: ${m.issueDate.toISOString().split("T")[0]} | Source: ${m.source} | Litres: ${m.litres}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
