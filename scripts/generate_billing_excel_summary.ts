import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const adapter = new PrismaBetterSqlite3({ url: "./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== Generating Overall Billing Summary Excel ===");
  const bills = await prisma.bill.findMany();
  console.log(`Found ${bills.length} bills in the database.`);

  const lkr = (cents: number) => cents / 100;

  // Group key: `${projectCode}_${periodKey}`
  const groupMap = new Map<string, {
    projectCode: string;
    projectName: string;
    periodKey: string;
    rentalCents: number;
    fuelCents: number;
    subtotalCents: number;
    ssclCents: number;
    vatCents: number;
    grandCents: number;
    billCount: number;
  }>();

  for (const b of bills) {
    const pCode = b.projectCode || "UNASSIGNED";
    const pName = b.projectName || "Unassigned";
    const key = `${pCode}_${b.periodKey}`;
    
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        projectCode: pCode,
        projectName: pName,
        periodKey: b.periodKey,
        rentalCents: 0,
        fuelCents: 0,
        subtotalCents: 0,
        ssclCents: 0,
        vatCents: 0,
        grandCents: 0,
        billCount: 0,
      });
    }

    const val = groupMap.get(key)!;
    val.rentalCents += b.rentalAmountCents;
    val.fuelCents += b.fuelCostCents;
    val.subtotalCents += b.subtotalCents;
    val.ssclCents += b.ssclCents;
    val.vatCents += b.vatCents;
    val.grandCents += b.grandTotalCents;
    val.billCount += 1;
  }

  const sortedGroups = Array.from(groupMap.values()).sort((a, b) => {
    // Sort by period key first, then by project name
    const compPeriod = a.periodKey.localeCompare(b.periodKey);
    if (compPeriod !== 0) return compPeriod;
    return a.projectName.localeCompare(b.projectName);
  });

  const wsData: any[][] = [
    ["E&C Fleet Billing Summary — By Site & Month"],
    [],
    [
      "Month",
      "Site Code",
      "Site Name",
      "Vehicles Billed",
      "Rental Amount (LKR)",
      "Fuel Cost (LKR)",
      "Subtotal (LKR)",
      "SSCL 2.5% (LKR)",
      "VAT 18% (LKR)",
      "Grand Total (LKR)"
    ]
  ];

  let totalRental = 0;
  let totalFuel = 0;
  let totalSubtotal = 0;
  let totalSscl = 0;
  let totalVat = 0;
  let totalGrand = 0;

  for (const g of sortedGroups) {
    wsData.push([
      g.periodKey,
      g.projectCode,
      g.projectName,
      g.billCount,
      lkr(g.rentalCents),
      lkr(g.fuelCents),
      lkr(g.subtotalCents),
      lkr(g.ssclCents),
      lkr(g.vatCents),
      lkr(g.grandCents)
    ]);
    totalRental += g.rentalCents;
    totalFuel += g.fuelCents;
    totalSubtotal += g.subtotalCents;
    totalSscl += g.ssclCents;
    totalVat += g.vatCents;
    totalGrand += g.grandCents;
  }

  // Grand Total row
  wsData.push([]);
  wsData.push([
    "GRAND TOTAL",
    "",
    "",
    bills.length,
    lkr(totalRental),
    lkr(totalFuel),
    lkr(totalSubtotal),
    lkr(totalSscl),
    lkr(totalVat),
    lkr(totalGrand)
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-fit column widths
  const maxColWidths = wsData[2].map((_, colIdx) => {
    let maxLen = 10;
    for (let r = 2; r < wsData.length; r++) {
      const cellVal = wsData[r]?.[colIdx];
      if (cellVal != null) {
        const strVal = typeof cellVal === "number" ? cellVal.toLocaleString("en-LK", { minimumFractionDigits: 2 }) : String(cellVal);
        if (strVal.length > maxLen) maxLen = strVal.length;
      }
    }
    return { wch: maxLen + 2 };
  });
  ws["!cols"] = maxColWidths;

  XLSX.utils.book_append_sheet(wb, ws, "Billing Summary");

  const exportDir = path.join(process.cwd(), "billing_exports");
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const exportPath = path.join(exportDir, "overall_billing_summary.xlsx");
  XLSX.writeFile(wb, exportPath);
  console.log(`Summary workbook written successfully to: ${exportPath}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
