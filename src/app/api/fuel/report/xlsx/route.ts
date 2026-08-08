import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isSiteUser } from "@/lib/roles";
import { buildFuelIssueReport, parseReportParams } from "@/lib/reports/fuel-issue-report";
import * as XLSX from "xlsx";

// The Excel behind the Fuel Issue Report screen.
//
// It reads the same query string and calls the same builder, so the workbook is
// the screen — a download that disagrees with the page it came from is worse
// than no download, because the disagreement is only found later by a client.

export async function GET(request: NextRequest) {
  // The proxy bypasses /api/* for exports, so auth is enforced here.
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const p = parseReportParams((k) => searchParams.get(k));

  // A site login exports its own site whatever the query asks for.
  const pinned = isSiteUser(session.role) ? session.projectId ?? null : null;
  const siteId = pinned ?? (p.site || undefined);

  try {
    const [report, site] = await Promise.all([
      buildFuelIssueReport({ from: p.from, to: p.to, projectId: siteId, vehicle: p.vehicle, fuelKind: p.fuelKind }),
      siteId ? prisma.project.findUnique({ where: { id: siteId }, select: { code: true, name: true } }) : null,
    ]);

    const wb = XLSX.utils.book_new();

    const header = [
      ["EDWARD & CHRISTIE (PVT) LTD — FUEL ISSUE REPORT"],
      [site ? `${site.name} (${site.code})` : "All sites"],
      [`${p.fromStr} to ${p.toStr}`],
      ...(p.vehicle ? [[`Vehicle filter: ${p.vehicle}`]] : []),
      ...(p.fuelKind ? [[`Fuel: ${p.fuelKind.replace(/_/g, " ")}`]] : []),
      [`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} · fuel is attributed to the vehicle's allocated site, not the pump`],
      [],
      ["Date", "Vehicle", "Reg No", "Site", "Fuel", "Litres", "Cost (Rs.)", "Meter", "Meter Type", "Issued By", "Pump", "Source"],
    ];
    const body = report.rows.map((r) => [
      r.day, r.assetCode, r.assetRegNo ?? "", r.siteCode ?? "", r.fuelKind.replace(/_/g, " "),
      r.litres, Math.round(r.costCents / 100),
      r.meterReading ?? "", r.readingType ?? "",
      r.issuedBy, r.pumpName ?? "", r.source,
    ]);
    const totals = [
      [],
      ["TOTAL", "", "", "", "",
        report.totals.litres, Math.round(report.totals.costCents / 100),
        "", "", `${report.totals.issues} issues`, `${report.totals.vehicles} vehicles`, ""],
    ];
    if (report.truncated) totals.push([`Capped at 5,000 rows — narrow the date range to see the rest`]);

    const ws = XLSX.utils.aoa_to_sheet([...header, ...body, ...totals]);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 26 }, { wch: 34 }];
    XLSX.utils.book_append_sheet(wb, ws, "Fuel Issues");

    // A per-site sheet only earns its place when more than one site is in range.
    if (report.perSite.length > 1) {
      const summary = XLSX.utils.aoa_to_sheet([
        ["Site", "Name", "Litres", "Cost (Rs.)", "Issues"],
        ...report.perSite.map((s) => [s.code, s.name, s.litres, Math.round(s.costCents / 100), s.issues]),
      ]);
      summary["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, summary, "By Site");
    }

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const name = `fuel-issues-${site?.code ?? "all-sites"}-${p.fromStr}-to-${p.toStr}.xlsx`;
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    console.error("fuel issue report xlsx failed", err);
    return new NextResponse("Failed to build the report", { status: 500 });
  }
}
