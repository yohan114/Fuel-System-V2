import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Streams a service-record attachment. Admins see any; the uploader sees their
// own; a site user sees attachments for vehicles on their own project/site.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const att = await prisma.serviceAttachment.findUnique({
    where: { id },
    select: {
      data: true,
      mimeType: true,
      originalName: true,
      uploadedById: true,
      serviceRecord: { select: { asset: { select: { projectId: true } } } },
    },
  });
  if (!att || !att.data) return new NextResponse("Not found", { status: 404 });

  const isAdmin = session.role === "ADMIN";
  const isOwner = att.uploadedById === session.userId;
  const sameSite = !!session.projectId && att.serviceRecord.asset.projectId === session.projectId;
  if (!isAdmin && !isOwner && !sameSite) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = Buffer.from(att.data);
  const safeName = (att.originalName || "attachment").replace(/[^\w.\-]+/g, "_");
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": att.mimeType || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
