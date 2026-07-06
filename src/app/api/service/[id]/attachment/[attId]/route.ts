import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Streams a file (scanned sheet, photo …) attached to a service record.
// Mirrors the correction-document route. Admin and workshop see any; a site
// user only their own project's service attachments.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string; attId: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id, attId } = await ctx.params;
  const att = await prisma.serviceAttachment.findUnique({
    where: { id: attId },
    select: {
      data: true, mimeType: true, fileName: true, serviceRecordId: true,
      serviceRecord: { select: { asset: { select: { projectId: true } } } },
    },
  });
  if (!att || att.serviceRecordId !== id) return new NextResponse("Not found", { status: 404 });

  const privileged = session.role === "ADMIN" || session.role === "WORKSHOP";
  const sameSite = !!session.projectId && att.serviceRecord.asset.projectId === session.projectId;
  if (!privileged && !sameSite) return new NextResponse("Forbidden", { status: 403 });

  const body = Buffer.from(att.data);
  const safeName = (att.fileName || "attachment").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
