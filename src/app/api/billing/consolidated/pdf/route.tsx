import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderToStream } from "@react-pdf/renderer";
import { ConsolidatedDocument, explodeBillsBySite } from "@/lib/billing/consolidated-document";
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

  // A vehicle that moved between sites during the month carries one bill whose
  // projectCode is only its *dominant* site, plus a line item per site it
  // actually worked. Filtering the query by projectCode therefore dropped that
  // vehicle from the receiving site's statement entirely — Galagedara lost
  // MG-07's Rs. 141,293.79 slice that way. So fetch the whole month, split each
  // bill into its per-site portions, and filter afterwards.
  const raw = await prisma.bill.findMany({
    where: { year, month },
    include: { lineItems: true },
    orderBy: [{ projectName: "asc" }, { grandTotalCents: "desc" }],
  });

  const projects = await prisma.project.findMany({ select: { id: true, code: true } });
  const codeById = new Map(projects.map((p) => [p.id, p.code]));

  const exploded = explodeBillsBySite(raw, codeById);
  const bills = siteCode ? exploded.filter((b) => b.projectCode === siteCode) : exploded;

  if (bills.length === 0) {
    return new NextResponse(`No bills found for ${periodKey}${siteCode ? ` at site ${siteCode}` : ""}`, { status: 404 });
  }

  // Statement of account: reconcile invoices with credit notes + payments.
  // Credits/payments live on the real invoice, not on a per-site slice.
  const billIds = [...new Set(bills.map((b) => b.originBillId ?? b.id))];
  const [creditRows, paymentRows] = await Promise.all([
    prisma.creditNote.findMany({ where: { billId: { in: billIds } } }),
    prisma.payment.findMany({ where: { billId: { in: billIds } } }),
  ]);
  const statements = buildSiteStatements(
    bills.map((b) => ({
      billId: b.originBillId ?? b.id, projectId: b.projectId, projectName: b.projectName, projectCode: b.projectCode,
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
  } catch (err: any) {
    console.error("Consolidated PDF error:", err);
    return new NextResponse("Failed to compile consolidated PDF.", { status: 500 });
  }
}
