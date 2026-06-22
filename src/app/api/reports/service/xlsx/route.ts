import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { aggregateServiceData } from "@/lib/reports/service-report";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { searchParams } = request.nextUrl;
  const fromStr = searchParams.get("from");
  const toStr = searchParams.get("to");
  if (!fromStr || !toStr) return new NextResponse("Missing required parameters: from, to", { status: 400 });

  const from = new Date(`${fromStr}T00:00:00Z`);
  const to = new Date(`${toStr}T23:59:59Z`);
  const projectId = session.role === "USER" && session.projectId ? session.projectId : undefined;

  try {
    const d = await aggregateServiceData({ from, to, projectId });
    const money = (c: number) => Math.round(c) / 100;
    const wb = XLSX.utils.book_new();

    const summary = [
      ["EDWARD & CHRISTIE — SERVICE & MAINTENANCE REPORT"],
      [],
      ["Date Range Start", fromStr],
      ["Date Range End", toStr],
      [],
      ["Total Service Spend (LKR)", money(d.totalCents)],
      ["  Parts (LKR)", money(d.partsCents)],
      ["  Labour (LKR)", money(d.labourCents)],
      ["  Sundry (LKR)", money(d.sundryCents)],
      ["Service Records", d.recordCount],
      ["Vehicles Serviced", d.vehicleCount],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

    const vh = [["E&C Number", "Description", "Category", "Site", "Services", "Spend (LKR)"], ...d.topVehicles.map((v) => [v.code, v.label, v.category, v.site || "—", v.count, money(v.cents)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vh), "By Vehicle");

    const st = [["Site", "Code", "Services", "Spend (LKR)"], ...d.bySite.map((s) => [s.name, s.code, s.count, money(s.cents)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), "By Site");

    const ct = [["Category", "Services", "Spend (LKR)"], ...d.byCategory.map((c) => [c.name, c.count, money(c.cents)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ct), "By Category");

    const fl = [["Filter No.", "Category", "Qty Used", "Spend (LKR)"], ...d.filtersUsed.map((f) => [f.filterNo || "(no part no.)", f.category, f.qty, money(f.cents)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fl), "Filters Used");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="service_report_${fromStr}_to_${toStr}.xlsx"`,
      },
    });
  } catch (err) {
    console.error("Service xlsx error:", err);
    return new NextResponse("Failed to compile excel workbook.", { status: 500 });
  }
}
