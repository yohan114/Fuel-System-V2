import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderToStream } from "@react-pdf/renderer";
import { ConsolidatedDocument } from "@/lib/billing/consolidated-document";
import { buildSiteStatements, totalStatement } from "@/lib/billing/statement";

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

  const where: any = { year, month };
  if (siteCode) where.projectCode = siteCode;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  // Statement of account: reconcile invoices with credit notes + payments.
  const billIds = bills.map((b) => b.id);
  const [creditRows, paymentRows] = await Promise.all([
    prisma.creditNote.findMany({ where: { billId: { in: billIds } } }),
    prisma.payment.findMany({ where: { billId: { in: billIds } } }),
  ]);
  const statements = buildSiteStatements(
    bills.map((b) => ({
      billId: b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode,
      assetCode: b.assetCode, invoiceNumber: b.invoiceNumber, status: b.status, grandTotalCents: b.grandTotalCents,
    })),
    creditRows.map((c) => ({ billId: c.billId, number: c.number, reason: c.reason, amountCents: c.amountCents, status: c.status })),
    paymentRows.map((p) => ({ billId: p.billId, amountCents: p.amountCents, paidDate: p.paidDate, method: p.method, reference: p.reference })),
  );
  const stmtTotals = totalStatement(statements);

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
