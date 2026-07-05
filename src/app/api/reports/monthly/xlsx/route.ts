import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aggregateFuelData } from "@/lib/reports/aggregate";
import { resolvePeriod, currentMonthPeriod } from "@/lib/billing/period";
import * as XLSX from "xlsx";

// Monthly site-wise fuel-operations report: per-site vehicle counts + daily
// fuel issues + total quantity + actual entered meter reading + the
// system-recommended hours/km (fuel ÷ typical consumption rate). Distinct from
// the money-focused consolidated billing export.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const now = new Date();
  const yearParam = parseInt(searchParams.get("year") || "", 10);
  const monthParam = parseInt(searchParams.get("month") || "", 10);
  const period =
    yearParam && monthParam >= 1 && monthParam <= 12
      ? resolvePeriod(yearParam, monthParam)
      : currentMonthPeriod(now);

  // A site PM (USER) only ever sees their own project; admins/allocators may
  // optionally scope with ?projectId=.
  const projectId =
    session.role === "USER"
      ? session.projectId ?? undefined
      : searchParams.get("projectId") ?? undefined;

  const monthLabel = new Date(period.year, period.month - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  try {
    const data = await aggregateFuelData({ from: period.start, to: period.end, projectId });

    const lkr = (cents: number) => cents / 100;
    const wb = XLSX.utils.book_new();

    // ---- Sheet 1: Site Summary --------------------------------------------
    const summary: any[][] = [
      ["EDWARD & CHRISTIE — MONTHLY FUEL OPERATIONS REPORT"],
      [`Period: ${monthLabel}`],
      [],
      ["Site", "Vehicles", "Total Fuel (L)", "Auto Diesel (L)", "Super Diesel (L)", "Fuel Cost (LKR)"],
    ];
    for (const s of data.siteBreakdown) {
      summary.push([
        s.name,
        s.vehicleCount,
        round1(s.totalLitres),
        round1(s.autoLitres),
        round1(s.superLitres),
        lkr(s.costCents),
      ]);
    }
    const totalVehicles = data.siteBreakdown.reduce((a, s) => a + s.vehicleCount, 0);
    summary.push([
      "GRAND TOTAL",
      totalVehicles,
      round1(data.totalLitres),
      "",
      "",
      lkr(data.totalCostCents),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Site Summary");

    // ---- Sheet 2: Vehicle Detail (grouped by site) ------------------------
    const detailHeader = [
      "E&C No",
      "Category",
      "Meter",
      "Fuel Issues",
      "Total Fuel (L)",
      "Actual Meter (Δ)",
      "Recommended (hrs/km)",
      "Variance %",
      "Flag",
    ];
    // Group asset rows by site name (assetBreakdown carries projectName now).
    const bySite = new Map<string, typeof data.assetBreakdown>();
    for (const a of data.assetBreakdown) {
      const key = a.projectName || "Unassigned / Global Pool";
      if (!bySite.has(key)) bySite.set(key, []);
      bySite.get(key)!.push(a);
    }
    const detail: any[][] = [
      [`Vehicle Detail by Site — ${monthLabel}`],
      [],
    ];
    for (const [siteName, rows] of [...bySite.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      detail.push([`SITE: ${siteName}  (${rows.length} vehicles)`]);
      detail.push(detailHeader);
      for (const a of rows) {
        detail.push([
          a.code,
          a.categoryName,
          a.meterType,
          a.issueCount,
          round1(a.litres),
          a.runningDelta > 0 ? round1(a.runningDelta) : "—",
          a.recommended != null ? round1(a.recommended) : "—",
          a.variancePct != null ? `${(a.variancePct * 100).toFixed(0)}%` : "—",
          flagLabel(a.flag),
        ]);
      }
      detail.push([]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detail), "Vehicle Detail");

    // ---- Sheet 3: Daily Fuel (date × site pivot) --------------------------
    const dailyIssues = await prisma.fuelIssue.findMany({
      where: {
        voided: false,
        issueDate: { gte: period.start, lte: period.end },
        ...(projectId ? { asset: { projectId } } : {}),
      },
      select: {
        issueDate: true,
        litres: true,
        asset: { select: { project: { select: { name: true } } } },
      },
      orderBy: { issueDate: "asc" },
    });
    const siteNames = data.siteBreakdown.map((s) => s.name);
    const pivot = new Map<string, Map<string, number>>(); // day -> site -> litres
    for (const it of dailyIssues) {
      const day = it.issueDate.toISOString().split("T")[0];
      const site = it.asset.project?.name || "Unassigned / Global Pool";
      if (!pivot.has(day)) pivot.set(day, new Map());
      const row = pivot.get(day)!;
      row.set(site, (row.get(site) || 0) + it.litres);
    }
    const daily: any[][] = [["Date", ...siteNames, "Total"]];
    for (const day of [...pivot.keys()].sort()) {
      const row = pivot.get(day)!;
      const cells = siteNames.map((s) => round1(row.get(s) || 0));
      const total = [...row.values()].reduce((a, b) => a + b, 0);
      daily.push([day, ...cells, round1(total)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), "Daily Fuel");

    const fileSuffix = `${period.periodKey}${projectId ? "_scoped" : ""}`;
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="monthly_fuel_report_${fileSuffix}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Monthly report XLSX error:", err);
    return new NextResponse("Failed to compile monthly report.", { status: 500 });
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function flagLabel(flag: string): string {
  if (flag === "METER_LOW") return "METER LOW (under-recorded?)";
  if (flag === "METER_HIGH") return "METER HIGH";
  return "OK";
}
