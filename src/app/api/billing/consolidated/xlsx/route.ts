import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || "", 10);
  const month = parseInt(searchParams.get("month") || "", 10);

  if (!year || !month || month < 1 || month > 12) {
    return new NextResponse("year and month query parameters are required", { status: 400 });
  }

  const periodKey = `${year}-${String(month).padStart(2, "0")}`;
  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const siteCode = searchParams.get("site")?.trim() || null;

  const where: any = { year, month };
  if (siteCode) where.projectCode = siteCode;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: [{ projectName: "asc" }, { assetCode: "asc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  const lkr = (cents: number) => cents / 100;
  const sumBills = (list: typeof bills) =>
    list.reduce(
      (a, b) => {
        a.rental += b.rentalAmountCents;
        a.fuel += b.fuelCostCents;
        a.subtotal += b.subtotalCents;
        a.sscl += b.ssclCents;
        a.vat += b.vatCents;
        a.grand += b.grandTotalCents;
        return a;
      },
      { rental: 0, fuel: 0, subtotal: 0, sscl: 0, vat: 0, grand: 0 }
    );

  // Group bills by site
  const groups = new Map<string, { name: string; bills: typeof bills }>();
  for (const b of bills) {
    const key = b.projectId || "__unassigned__";
    if (!groups.has(key)) groups.set(key, { name: b.projectName || "Unassigned", bills: [] });
    groups.get(key)!.bills.push(b);
  }
  const siteGroups = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));

  try {
    const wb = XLSX.utils.book_new();

    const header = [
      "E&C No", "Vehicle", "Reg No", "Mode", "Basis",
      "Billable Units", "Rental (LKR)", "Fuel (LKR)", "Subtotal (LKR)",
      "SSCL (LKR)", "VAT (LKR)", "Grand Total (LKR)", "Status", "Invoice No",
      "Actual Meter", "Recommended (fuel)",
    ];
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const tot = sumBills(bills);

    // Sheet 1: site-wise consolidated (section per site)
    const sheet1: any[][] = [
      [`${"EDWARD AND CHRISTIE GROUP"} — CONSOLIDATED BILLING BY SITE — ${monthLabel}`],
      [],
    ];
    for (const g of siteGroups) {
      const st = sumBills(g.bills);
      sheet1.push([`SITE: ${g.name}  (${g.bills.length} vehicles)`]);
      sheet1.push(header);
      for (const b of g.bills) {
        sheet1.push([
          b.assetCode, b.assetLabel || "", b.assetRegNo || "",
          b.billingMode, b.rateBasis,
          b.billableUnits, lkr(b.rentalAmountCents), lkr(b.fuelCostCents), lkr(b.subtotalCents),
          lkr(b.ssclCents), lkr(b.vatCents), lkr(b.grandTotalCents), b.status, b.invoiceNumber || "",
          b.actualMeterUnits != null ? round1(b.actualMeterUnits) : "",
          b.derivedStandardUnits != null ? round1(b.derivedStandardUnits) : "",
        ]);
      }
      sheet1.push([
        "SITE TOTAL", "", "", "", "", "",
        lkr(st.rental), lkr(st.fuel), lkr(st.subtotal), lkr(st.sscl), lkr(st.vat), lkr(st.grand), "", "", "", "",
      ]);
      sheet1.push([]);
    }
    sheet1.push([
      "GRAND TOTAL (ALL SITES)", "", "", "", "", "",
      lkr(tot.rental), lkr(tot.fuel), lkr(tot.subtotal), lkr(tot.sscl), lkr(tot.vat), lkr(tot.grand), "", "", "", "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "By Site");

    // Sheet 2: site summary
    const siteSummary: any[][] = [
      ["Consolidated Billing — Site Summary"],
      ["Period", monthLabel],
      ["Sites", siteGroups.length],
      ["Total Vehicles", bills.length],
      [],
      ["Site", "Vehicles", "Rental (LKR)", "Fuel (LKR)", "SSCL (LKR)", "VAT (LKR)", "Grand Total (LKR)"],
    ];
    for (const g of siteGroups) {
      const st = sumBills(g.bills);
      siteSummary.push([g.name, g.bills.length, lkr(st.rental), lkr(st.fuel), lkr(st.sscl), lkr(st.vat), lkr(st.grand)]);
    }
    siteSummary.push(["GRAND TOTAL", bills.length, lkr(tot.rental), lkr(tot.fuel), lkr(tot.sscl), lkr(tot.vat), lkr(tot.grand)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(siteSummary), "Site Summary");

    const fileSuffix = siteCode ? `${siteCode}_${periodKey}` : periodKey;
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="consolidated_billing_${fileSuffix}.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Consolidated XLSX error:", err);
    return new NextResponse("Failed to compile consolidated workbook.", { status: 500 });
  }
}
