import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Streams the signed running-chart document attached to a correction request.
// Admins see any; a site user sees their own site's documents and their own
// submissions.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const corr = await prisma.fuelIssueCorrection.findUnique({
    where: { id },
    select: { docData: true, docMime: true, docName: true, requestedById: true, projectId: true },
  });
  if (!corr) return new NextResponse("Not found", { status: 404 });

  const isAdmin = session.role === "ADMIN";
  const isOwner = corr.requestedById === session.userId;
  const sameSite = !!session.projectId && corr.projectId === session.projectId;
  if (!isAdmin && !isOwner && !sameSite) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = Buffer.from(corr.docData);
  const safeName = (corr.docName || "document").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": corr.docMime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
