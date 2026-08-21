import { canReadBillFor } from "@/lib/roles";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeSiteSplit } from "@/lib/billing/site-split";
import { apportionCents } from "@/lib/billing/site-explode";
import * as XLSX from "xlsx";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const bill = await prisma.bill.findUnique({ where: { id }, include: { lineItems: true } });
  if (!bill) return new NextResponse("Not found", { status: 404 });

  // Allow-list check: administrators see everything, a site login sees only its
  // own site, and every other role — including WORKSHOP — sees nothing.
  if (!canReadBillFor(session, bill.projectId)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const lkr = (cents: number) => cents / 100;
  const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  try {
    const wb = XLSX.utils.book_new();

    const summary = [
      ["EDWARD & CHRISTIE — MACHINE RENTAL INVOICE"],
      [],
      ["Invoice Number", bill.invoiceNumber || "DRAFT"],
      ["Status", bill.status],
      ["Period", monthLabel],
      ["Site", bill.projectName || "Unassigned"],
      ["Vehicle", bill.assetCode],
      ["Registration", bill.assetRegNo || ""],
      ["Description", bill.assetLabel || ""],
      [],
      ["Billing Mode", bill.billingMode],
      ["Rate Basis", bill.rateBasis],
      ["Rate (LKR/unit)", lkr(bill.rateCents)],
      ["Actual Meter-derived Units", bill.actualMeterUnits != null ? bill.actualMeterUnits : (bill.derivedFromFuel ? 0 : bill.actualUnits)],
      ["Actual Standard (fuel-derived)", bill.derivedStandardUnits ?? ""],
      ["Actual Economy (fuel-derived)", bill.derivedEconUnits ?? ""],
      ["Actual Units (Billed)", bill.actualUnits],
      ["Minimum Units", bill.minimumUnits],
      ["Billable Units", bill.billableUnits],
      ["Opening Meter", bill.openingMeter ?? ""],
      ["Closing Meter", bill.closingMeter ?? ""],
      ["Fuel Litres", bill.fuelLitres],
      [],
      ["Rental (LKR)", lkr(bill.rentalAmountCents)],
      ["Fuel Charged (LKR)", bill.rateBasis === "fw" ? lkr(bill.fuelCostCents) : 0],
      ["Subtotal (LKR)", lkr(bill.subtotalCents)],
      [`SSCL ${(bill.ssclRate * 100).toFixed(1)}% (LKR)`, lkr(bill.ssclCents)],
      [`VAT ${(bill.vatRate * 100).toFixed(1)}% (LKR)`, lkr(bill.vatCents)],
      ["GRAND TOTAL (LKR)", lkr(bill.grandTotalCents)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Invoice");

    const liHeader = ["Charge", "Description", "Quantity", "Unit", "Unit Rate (LKR)", "Amount (LKR)"];
    const liRows = bill.lineItems.map((li) => [
      li.kind, li.description, li.quantity, li.unit, lkr(li.unitRateCents), lkr(li.amountCents),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([liHeader, ...liRows]), "Line Items");

    // Site Split — for a machine that moved between sites, which site owes what.
    // The invoice stays one document; this sheet is what each site is charged,
    // tax included, and it adds back to the grand total exactly.
    const split = computeSiteSplit(bill.lineItems, bill.minimumUnits);
    if (split && split.rows.length > 1) {
      const unit = bill.billingMode === "perkm" ? "km" : "hr";
      const payable = apportionCents(bill.grandTotalCents, split.rows.map((r) => r.totalCents));
      const sheet: any[][] = [
        [`SITE SPLIT — ${bill.assetCode} — ${monthLabel}`],
        [`Worked ${split.rows.length} sites over ${split.totalDays} allocated days. Each site is charged for the days it had the machine; tax follows the charge.`],
        [],
        ["Site", "Days", `Min share (${unit})`, `Billed (${unit})`, "At minimum",
         "Rental (LKR)", "Fuel (LKR)", "Subtotal (LKR)", "Share of bill", "Payable incl. tax (LKR)"],
      ];
      split.rows.forEach((r, i) => {
        sheet.push([
          r.projectName, r.days, Math.round(r.minShareUnits * 10) / 10,
          Math.round(r.billableUnits * 10) / 10, r.atMinimum ? "yes" : "",
          lkr(r.rentalCents), lkr(r.fuelCents), lkr(r.totalCents),
          bill.subtotalCents > 0 ? r.totalCents / bill.subtotalCents : 0,
          lkr(payable[i]),
        ]);
      });
      sheet.push([
        "ALL SITES", split.totalDays, split.minimumUnits, Math.round(bill.billableUnits * 10) / 10, "",
        lkr(bill.rentalAmountCents), lkr(bill.fuelCostCents), lkr(bill.subtotalCents), 1,
        lkr(bill.grandTotalCents),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Site Split");
    }

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="invoice_${bill.assetCode}_${bill.periodKey}.xlsx"`,
      },
    });
  } catch (err: unknown) {
    console.error("Bill XLSX error:", err);
    return new NextResponse("Failed to compile invoice workbook.", { status: 500 });
  }
}
