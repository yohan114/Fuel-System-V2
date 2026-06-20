import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== GENERATING BILLING REPORT SUMMARY ===");

  const year = 2026;
  const month = 5;
  const periodKey = "2026-05";

  const bills = await prisma.bill.findMany({
    where: { year, month },
    include: { lineItems: true },
    orderBy: [{ projectName: "asc" }, { assetCode: "asc" }]
  });

  if (bills.length === 0) {
    console.log("No bills found for May 2026!");
    return;
  }

  let md = `# E&C Fleet Fuel Portal - Monthly Billing Summary Report\n`;
  md += `**Billing Period:** May 2026 (${periodKey})\n`;
  md += `**Report Generated On:** ${new Date().toLocaleString("en-LK")}\n\n`;

  // 1. Overall Summary Table
  md += `## 📊 Project Sites Overview\n\n`;
  md += `| Site Name | Vehicles/Machinery Billed | Total Rental (LKR) | Total Fuel Cost (LKR) | Grand Total (with Taxes) |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: |\n`;

  const siteSummary: Record<string, { rental: number; fuel: number; grand: number; count: number }> = {};
  for (const b of bills) {
    const site = b.projectName || "Unknown Site";
    if (!siteSummary[site]) {
      siteSummary[site] = { rental: 0, fuel: 0, grand: 0, count: 0 };
    }
    siteSummary[site].rental += b.rentalAmountCents;
    siteSummary[site].fuel += b.fuelCostCents;
    siteSummary[site].grand += b.grandTotalCents;
    siteSummary[site].count++;
  }

  let totalRental = 0;
  let totalFuel = 0;
  let totalGrand = 0;
  let totalVehicles = 0;

  for (const [site, s] of Object.entries(siteSummary)) {
    md += `| **${site}** | ${s.count} | Rs. ${(s.rental / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })} | Rs. ${(s.fuel / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })} | **Rs. ${(s.grand / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}** |\n`;
    totalRental += s.rental;
    totalFuel += s.fuel;
    totalGrand += s.grand;
    totalVehicles += s.count;
  }
  md += `| **TOTAL** | **${totalVehicles}** | **Rs. ${(totalRental / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}** | **Rs. ${(totalFuel / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}** | **Rs. ${(totalGrand / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}** |\n\n`;

  // 2. Breakdown per site
  const siteBills: Record<string, typeof bills> = {};
  for (const b of bills) {
    const site = b.projectName || "Unknown Site";
    if (!siteBills[site]) siteBills[site] = [];
    siteBills[site].push(b);
  }

  for (const [site, sBills] of Object.entries(siteBills)) {
    md += `## 📍 Site: ${site}\n\n`;
    md += `| Asset Code | Label | Billing Mode | Actual Meter | Billable Units | Fuel Litres | Rental Amt (LKR) | Fuel Amt (LKR) | Grand Total (LKR) |\n`;
    md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const b of sBills) {
      const actualText = b.billingMode === "perday" ? `${b.actualUnits} days` : b.billingMode === "perkm" ? `${b.actualUnits} km` : `${b.actualUnits.toFixed(1)} hrs`;
      const billableText = b.billingMode === "perday" ? `${b.billableUnits} days` : b.billingMode === "perkm" ? `${b.billableUnits} km` : `${b.billableUnits.toFixed(1)} hrs`;
      
      md += `| **${b.assetCode}** | ${b.assetLabel || "—"} | ${b.billingMode.toUpperCase()} (${b.rateBasis.toUpperCase()}) | ${actualText} | ${billableText} | ${b.fuelLitres}L | Rs. ${(b.rentalAmountCents / 100).toLocaleString("en-LK")} | Rs. ${(b.fuelCostCents / 100).toLocaleString("en-LK")} | **Rs. ${(b.grandTotalCents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}** |\n`;
    }
    md += `\n---\n\n`;
  }

  const outPath = path.join(process.cwd(), "billing_exports", "may_2026_summary.md");
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`Report successfully written to ${outPath}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
