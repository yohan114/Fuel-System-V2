import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  // Verify credentials. The proxy bypasses /api/reports/export/*, so this
  // handler must enforce auth itself (mirrors the PDF export route).
  const session = await getSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");

  if (!fromStr || !toStr) {
    return new NextResponse("Missing required parameters: from, to", { status: 400 });
  }

  const fromDate = new Date(`${fromStr}T00:00:00Z`);
  const toDate = new Date(`${toStr}T23:59:59Z`);

  try {
    const data = await aggregateFuelData({ from: fromDate, to: toDate });

    // Create new workbook
    const wb = XLSX.utils.book_new();

    // 1. Sheet: Summary Report
    const summaryData = [
      ["EDWARD & CHRISTIE FLEET MANAGEMENT PORTAL"],
      ["FUEL CONSUMPTION & COST AUDIT SUMMARY"],
      [],
      ["Report Parameter", "Value"],
      ["Date Range Start", fromStr],
      ["Date Range End", toStr],
      ["Total Volume Dispensed (Litres)", data.totalLitres],
      ["Total Spend (LKR)", data.totalCostCents / 100],
      ["Total Fueling Events", data.issueCount],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // 2. Sheet: By Asset
    const assetHeaders = [
      "E&C Number",
      "Brand",
      "Type",
      "Volume Issued (L)",
      "Spend (LKR)",
      "Usage Growth",
      "Meter Unit",
      "Fuel Efficiency"
    ];
    const assetRows = data.assetBreakdown.map(asset => {
      const formattedEff = asset.efficiency !== null
        ? asset.meterType === "KM"
          ? `${asset.efficiency.toFixed(2)} km/L`
          : `${asset.efficiency.toFixed(2)} L/hr`
        : "—";
      return [
        asset.code,
        asset.brand || "",
        asset.typeLabel || "",
        asset.litres,
        asset.costCents / 100,
        asset.runningDelta,
        asset.meterType,
        formattedEff
      ];
    });
    const wsAsset = XLSX.utils.aoa_to_sheet([assetHeaders, ...assetRows]);
    XLSX.utils.book_append_sheet(wb, wsAsset, "By Asset");

    // 3. Sheet: By Category
    const catHeaders = ["Category Name", "Category Code", "Volume Issued (L)", "Cost (LKR)"];
    const catRows = data.categoryBreakdown.map(cat => [
      cat.name,
      cat.code,
      cat.litres,
      cat.costCents / 100
    ]);
    const wsCat = XLSX.utils.aoa_to_sheet([catHeaders, ...catRows]);
    XLSX.utils.book_append_sheet(wb, wsCat, "By Category");

    // 4. Sheet: Daily Trend
    const trendHeaders = ["Date", "Volume (L)", "Cost (LKR)"];
    const trendRows = data.trend.map(t => [
      t.date,
      t.litres,
      t.costCents / 100
    ]);
    const wsTrend = XLSX.utils.aoa_to_sheet([trendHeaders, ...trendRows]);
    XLSX.utils.book_append_sheet(wb, wsTrend, "Daily Trend");

    // Compile worksheet structures to buffer
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="fuel_audit_${fromStr}_to_${toStr}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Excel generation error:", err);
    return new NextResponse("Failed to compile excel workbook.", { status: 500 });
  }
}
