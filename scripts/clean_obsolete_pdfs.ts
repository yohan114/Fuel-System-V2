import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as fs from "fs";
import * as path from "path";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function main() {
  console.log("=== CLEANING OBSOLETE PDF BILLS ===");

  const bills = await prisma.bill.findMany({
    select: {
      periodKey: true,
      projectName: true,
      projectCode: true,
      assetCode: true
    }
  });

  console.log(`Retrieved ${bills.length} active bills from database.`);

  const exportBaseDir = path.join(process.cwd(), "billing_exports");
  if (!fs.existsSync(exportBaseDir)) {
    console.log("billing_exports folder does not exist. Nothing to clean.");
    return;
  }

  // Build the set of active PDF paths we want to keep
  const validPdfPaths = new Set<string>();

  const activeSitesPerMonth = new Map<string, Set<string>>(); // key: periodKey, value: Set of projectCodes

  for (const b of bills) {
    if (!b.projectName) continue;
    const sanitizedProj = sanitizeName(b.projectName);
    const invoicePath = path.resolve(
      path.join(exportBaseDir, b.periodKey, sanitizedProj, `invoice_${b.assetCode}_${b.periodKey}.pdf`)
    );
    validPdfPaths.add(invoicePath);

    // Keep track of active site summaries to keep
    const periodKey = b.periodKey;
    if (!activeSitesPerMonth.has(periodKey)) {
      activeSitesPerMonth.set(periodKey, new Set());
    }
    if (b.projectCode) {
      activeSitesPerMonth.get(periodKey)!.add(b.projectCode);
      const summaryPath = path.resolve(
        path.join(exportBaseDir, periodKey, sanitizedProj, `monthly_summary_${b.projectCode}_${periodKey}.pdf`)
      );
      validPdfPaths.add(summaryPath);
    }
  }

  // Walk the billing_exports directory recursively
  let deletedFiles = 0;
  let keptFiles = 0;

  function walkAndClean(dir: string) {
    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walkAndClean(fullPath);
        // Clean up empty directories
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
          console.log(`Deleted empty folder: ${fullPath}`);
        }
      } else if (stat.isFile() && item.toLowerCase().endsWith(".pdf")) {
        const resolvedPath = path.resolve(fullPath);
        if (!validPdfPaths.has(resolvedPath)) {
          fs.unlinkSync(resolvedPath);
          console.log(`Deleted obsolete PDF: ${fullPath}`);
          deletedFiles++;
        } else {
          keptFiles++;
        }
      }
    }
  }

  walkAndClean(exportBaseDir);

  console.log("\n=============================================");
  console.log(`Obsolete PDF Clean Up Complete!`);
  console.log(`Deleted: ${deletedFiles} obsolete PDF file(s).`);
  console.log(`Kept:    ${keptFiles} valid PDF file(s).`);
  console.log("=============================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
