import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renderToStream } from "@react-pdf/renderer";
import { ConsolidatedDocument } from "@/lib/billing/consolidated-document";
import { loadConsolidatedBilling } from "@/lib/billing/consolidated-data";

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
  const siteCode = searchParams.get("site")?.trim() || null; // optional: filter to one site (project code)

  // Bills arrive already distributed to the sites that earned them: a vehicle
  // that worked three sites this month appears under all three, for its portion
  // at each, instead of billing its last site for the whole month.
  const { bills, statements, stmtTotals } = await loadConsolidatedBilling(year, month, siteCode);

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  bills.sort(
    (a, b) =>
      (a.projectName || "").localeCompare(b.projectName || "") || b.grandTotalCents - a.grandTotalCents
  );

  const generatedAt = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fileSuffix = siteCode ? `${siteCode}_${periodKey}` : periodKey;

  try {
    const stream = await renderToStream(
      <ConsolidatedDocument bills={bills} periodKey={periodKey} generatedAt={generatedAt} statements={statements} stmtTotals={stmtTotals} />
    );
    const response = new NextResponse(stream as any);
    response.headers.set("Content-Type", "application/pdf");
    response.headers.set("Content-Disposition", `attachment; filename="consolidated_billing_${fileSuffix}.pdf"`);
    return response;
  } catch (err: unknown) {
    console.error("Consolidated PDF error:", err);
    return new NextResponse("Failed to compile consolidated PDF.", { status: 500 });
  }
}
