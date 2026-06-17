import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renderInvoicePdfBuffer } from "@/lib/billing/invoice-document";

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const bill = await prisma.bill.findUnique({ where: { id }, include: { lineItems: true } });
  if (!bill) return new NextResponse("Not found", { status: 404 });

  if (session.role === "USER" && session.projectId && bill.projectId !== session.projectId) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const buffer = await renderInvoicePdfBuffer(bill);
    const fileTag = `${bill.assetCode}_${bill.periodKey}`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice_${fileTag}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("Bill PDF error:", err);
    return new NextResponse("Failed to compile invoice PDF.", { status: 500 });
  }
}
