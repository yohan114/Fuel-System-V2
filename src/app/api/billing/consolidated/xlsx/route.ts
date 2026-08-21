import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadConsolidatedBilling } from "@/lib/billing/consolidated-data";
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

  // Bills arrive already distributed to the sites that earned them — a vehicle
  // that moved between sites contributes its own portion to each, rather than
  // the whole month landing on the site it happened to finish at.
  const { bills, statements, stmtTotals, sourceBillCount, splitBillCount } =
    await loadConsolidatedBilling(year, month, siteCode);

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  const lkr = (cents: number) => cents / 100;
  const sumBills = (list: typeof bills) =>
    list.reduce(
      (a, b) => {
        a.rental += b.rentalAmountCents;
        a.fuel += b.fuelCostCents;
        a.litres += b.fuelLitres || 0;
        a.subtotal += b.subtotalCents;
        a.sscl += b.ssclCents;
        a.vat += b.vatCents;
        a.grand += b.grandTotalCents;
        return a;
      },
      { rental: 0, fuel: 0, litres: 0, subtotal: 0, sscl: 0, vat: 0, grand: 0 }
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
      "E&C No", "Vehicle", "Reg No", "Driver", "Mode", "Basis", "Days on Site",
      "Fuel (L)", "Actual Meter", "Billable Units", "Unit Rate (LKR)",
      "Rental (LKR)", "Fuel (LKR)", "Subtotal (LKR)",
      "SSCL (LKR)", "VAT (LKR)", "Grand Total (LKR)", "Status", "Invoice No",
      "Recommended (fuel)",
    ];
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const basisLabel = (b: string) => (b === "d" ? "Dry" : b === "fw" ? "Fully Wet" : "Wet");
    // Basis label that also states whether fuel is billed — Dry excludes fuel,
    // Wet/Fully-Wet include it.
    const basisWithFuel = (b: string) =>
      b === "d" ? "Dry (no fuel)" : b === "fw" ? "Fully Wet (+fuel)" : "Wet (+fuel)";
    const isDry = (b: string) => b === "d";
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
        const fuelOnly = b.rentalAmountCents === 0 && b.fuelCostCents > 0;
        sheet1.push([
          b.assetCode, b.assetLabel || "", b.assetRegNo || "", b.driverName || "",
          fuelOnly ? "Fuel only" : b.billingMode, fuelOnly ? "Fuel only" : basisWithFuel(b.rateBasis),
          b.assignedDays ? round1(b.assignedDays) : "",
          round1(b.fuelLitres || 0),
          fuelOnly ? "" : (b.actualMeterUnits != null ? round1(b.actualMeterUnits) : ""),
          fuelOnly ? "" : round1(b.billableUnits),
          fuelOnly || !b.rateCents ? "" : lkr(b.rateCents),
          lkr(b.rentalAmountCents), lkr(b.fuelCostCents), lkr(b.subtotalCents),
          lkr(b.ssclCents), lkr(b.vatCents), lkr(b.grandTotalCents), b.status, b.invoiceNumber || "",
          b.derivedStandardUnits != null ? round1(b.derivedStandardUnits) : "",
        ]);
      }
      sheet1.push([
        "SITE TOTAL", "", "", "", "", "", round1(g.bills.reduce((n, b: any) => n + (b.assignedDays || 0), 0)),
        round1(st.litres), "", "", "",
        lkr(st.rental), lkr(st.fuel), lkr(st.subtotal), lkr(st.sscl), lkr(st.vat), lkr(st.grand), "", "", "",
      ]);
      sheet1.push([]);
    }
    sheet1.push([
      "GRAND TOTAL (ALL SITES)", "", "", "", "", "", round1(bills.reduce((n, b: any) => n + (b.assignedDays || 0), 0)),
      round1(tot.litres), "", "", "",
      lkr(tot.rental), lkr(tot.fuel), lkr(tot.subtotal), lkr(tot.sscl), lkr(tot.vat), lkr(tot.grand), "", "", "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "By Site");

    // Sheet 2: site summary
    const siteSummary: any[][] = [
      ["Consolidated Billing — Site Summary"],
      ["Period", monthLabel],
      ["Sites", siteGroups.length],
      ["Total Vehicles", sourceBillCount],
      // A machine that moved during the month is charged to each site for the
      // days it was there, so it appears once per site below.
      ["Vehicles split across sites", splitBillCount],
      ["Site-wise rows", bills.length],
      [],
      ["Site", "Vehicles", "Rental (LKR)", "Fuel (LKR)", "SSCL (LKR)", "VAT (LKR)", "Grand Total (LKR)"],
    ];
    for (const g of siteGroups) {
      const st = sumBills(g.bills);
      siteSummary.push([g.name, g.bills.length, lkr(st.rental), lkr(st.fuel), lkr(st.sscl), lkr(st.vat), lkr(st.grand)]);
    }
    siteSummary.push(["GRAND TOTAL", sourceBillCount, lkr(tot.rental), lkr(tot.fuel), lkr(tot.sscl), lkr(tot.vat), lkr(tot.grand)]);

    // Dry vs Wet split — per site and overall.
    const dryBills = bills.filter((b) => isDry(b.rateBasis));
    const wetBills = bills.filter((b) => !isDry(b.rateBasis));
    siteSummary.push([], ["DRY vs WET SPLIT"], ["Basis", "Vehicles", "Rental (LKR)", "Fuel (LKR)", "Grand Total (LKR)"]);
    for (const g of siteGroups) {
      const d = g.bills.filter((b: any) => isDry(b.rateBasis));
      const w = g.bills.filter((b: any) => !isDry(b.rateBasis));
      const sd = sumBills(d), sw = sumBills(w);
      if (d.length) siteSummary.push([`${g.name} — Dry`, d.length, lkr(sd.rental), lkr(sd.fuel), lkr(sd.grand)]);
      if (w.length) siteSummary.push([`${g.name} — Wet`, w.length, lkr(sw.rental), lkr(sw.fuel), lkr(sw.grand)]);
    }
    const sdAll = sumBills(dryBills), swAll = sumBills(wetBills);
    siteSummary.push(
      ["ALL SITES — Dry", dryBills.length, lkr(sdAll.rental), lkr(sdAll.fuel), lkr(sdAll.grand)],
      ["ALL SITES — Wet", wetBills.length, lkr(swAll.rental), lkr(swAll.fuel), lkr(swAll.grand)],
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(siteSummary), "Site Summary");

    // Sheet 3: statement-of-account summary — invoiced / credited / paid /
    // outstanding per site (the reconciled closing balance).
    const stmtSummary: any[][] = [
      [`STATEMENT OF ACCOUNT — ${monthLabel}`],
      [],
      ["Site", "Invoices", "Invoiced (LKR)", "Credits (LKR)", "Paid (LKR)", "Outstanding (LKR)"],
    ];
    for (const s of statements) {
      stmtSummary.push([
        s.projectName, s.invoices.length,
        lkr(s.invoicedCents), lkr(s.creditedCents), lkr(s.paidCents), lkr(s.outstandingCents),
      ]);
    }
    stmtSummary.push([
      "GRAND TOTAL", "",
      lkr(stmtTotals.invoicedCents), lkr(stmtTotals.creditedCents), lkr(stmtTotals.paidCents), lkr(stmtTotals.outstandingCents),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stmtSummary), "Statement");

    // Sheet 4: statement detail — every invoice, credit note and payment per
    // site, closing with the outstanding balance.
    const stmtDetail: any[][] = [[`STATEMENT OF ACCOUNT (DETAIL) — ${monthLabel}`], []];
    for (const s of statements) {
      stmtDetail.push([`SITE: ${s.projectName}${s.projectCode ? `  (${s.projectCode})` : ""}`]);
      stmtDetail.push(["Invoices", "Vehicle", "Status", "Amount (LKR)"]);
      for (const inv of s.invoices) {
        stmtDetail.push([inv.invoiceNumber || "(unissued)", inv.assetCode, inv.status, lkr(inv.grandTotalCents)]);
      }
      stmtDetail.push(["", "", "Invoiced", lkr(s.invoicedCents)]);
      if (s.creditNotes.length > 0) {
        stmtDetail.push([]);
        stmtDetail.push(["Credit Notes", "Reason", "Status", "Amount (LKR)"]);
        for (const c of s.creditNotes) {
          stmtDetail.push([c.number || "(draft)", c.reason, c.status, lkr(c.amountCents)]);
        }
        stmtDetail.push(["", "", "Credited (issued)", lkr(s.creditedCents)]);
      }
      if (s.payments.length > 0) {
        stmtDetail.push([]);
        stmtDetail.push(["Payments", "Method", "Reference", "Amount (LKR)"]);
        for (const p of s.payments) {
          stmtDetail.push([
            new Date(p.paidDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
            p.method || "—", p.reference || "—", lkr(p.amountCents),
          ]);
        }
        stmtDetail.push(["", "", "Paid", lkr(s.paidCents)]);
      }
      stmtDetail.push(["", "", "OUTSTANDING", lkr(s.outstandingCents)]);
      stmtDetail.push([]);
    }
    stmtDetail.push(["GRAND OUTSTANDING (ALL SITES)", "", "", lkr(stmtTotals.outstandingCents)]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stmtDetail), "Statement Detail");

    const fileSuffix = siteCode ? `${siteCode}_${periodKey}` : periodKey;
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="consolidated_billing_${fileSuffix}.xlsx"`,
      },
    });
  } catch (err: unknown) {
    console.error("Consolidated XLSX error:", err);
    return new NextResponse("Failed to compile consolidated workbook.", { status: 500 });
  }
}
