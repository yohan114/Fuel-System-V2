import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { fuelKindLabel } from "@/lib/fuel-kinds";
import { prisma } from "@/lib/db";
import { buildFuelIssueReport, parseRange, ymd } from "@/lib/fuel/issue-report";
import * as XLSX from "xlsx";

// Excel export of the Fuel Issue Report. Runs the same query as the on-screen
// table (including the site-user scoping, which is applied inside
// buildFuelIssueReport), so the workbook always matches what was displayed.
//
// The proxy already guards this path (it exempts only /api/cron,
// /api/reports/export, /api/health and /api/portal), but the session is
// re-checked here so the export cannot be reached if that list ever changes.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const sp = request.nextUrl.searchParams;
  const { from, to } = parseRange(sp.get("from"), sp.get("to"));
  const siteId = sp.get("site");
  const vehicle = sp.get("vehicle");
  const fuelKind = sp.get("fuelKind");

  try {
    const report = await buildFuelIssueReport(
      { from, to, siteId, vehicle, fuelKind },
      { role: session.role, projectId: session.projectId },
    );

    const site = siteId ? await prisma.project.findUnique({ where: { id: siteId }, select: { name: true, code: true } }) : null;
    const scope = site ? `${site.name} (${site.code})` : "All sites";

    const header = [
      ["EDWARD & CHRISTIE — FUEL ISSUE REPORT"],
      [`Scope: ${scope}`],
      [`Vehicle filter: ${vehicle ? vehicle.toUpperCase() : "All vehicles"}`],
      [`Fuel: ${fuelKind ? fuelKindLabel(fuelKind) : "All fuels"}`],
      [`Period: ${ymd(from)} to ${ymd(to)}`],
      [`Generated: ${new Date().toLocaleString("en-GB")} by ${session.name}`],
      [],
      ["Date", "Vehicle", "Reg No", "Site", "Fuel", "Litres", "Rate (Rs/L)", "Cost (Rs)", "Meter", "Unit", "Issued By", "Pump", "Status"],
    ];

    const body = report.rows.map((r) => [
      ymd(new Date(r.issueDate)),
      r.assetCode,
      r.assetRegNo ?? "",
      r.siteCode ?? "",
      fuelKindLabel(r.fuelKind),
      r.litres,
      r.pricePerLitreCents / 100,
      r.totalCostCents / 100,
      r.meterReading ?? "",
      r.readingType ?? "",
      r.issuedByName,
      r.source,
      r.voided ? "VOIDED" : "",
    ]);

    const footer = [
      [],
      ["TOTAL", "", "", "", "", report.totals.litres, "", report.totals.costCents / 100, "", "", "", "", ""],
      [`${report.totals.issueCount} fuel issues across ${report.totals.vehicleCount} vehicles`],
    ];
    if (report.truncated) footer.push([`NOTE: capped at the first ${report.rows.length} rows — narrow the range for a complete report.`]);

    const ws = XLSX.utils.aoa_to_sheet([...header, ...body, ...footer]);
    ws["!cols"] = [
      { wch: 11 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 9 },
      { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 7 }, { wch: 18 }, { wch: 22 }, { wch: 9 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fuel Issues");

    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const name = `fuel-issues_${site?.code ?? "all-sites"}${vehicle ? `_${vehicle.toUpperCase()}` : ""}_${ymd(from)}_to_${ymd(to)}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Fuel report xlsx error:", err);
    return new NextResponse("Failed to generate the Excel report", { status: 500 });
  }
}
