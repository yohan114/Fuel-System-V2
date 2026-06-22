import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Streams the optional pump/meter photo attached to a fuel issue. Admins see
// any; the issuer sees their own; a site user sees their own site's issues.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const issue = await prisma.fuelIssue.findUnique({
    where: { id },
    select: {
      photoData: true,
      photoMime: true,
      photoName: true,
      issuedById: true,
      asset: { select: { projectId: true } },
    },
  });
  if (!issue || !issue.photoData) return new NextResponse("Not found", { status: 404 });

  const isAdmin = session.role === "ADMIN";
  const isOwner = issue.issuedById === session.userId;
  const sameSite = !!session.projectId && issue.asset.projectId === session.projectId;
  if (!isAdmin && !isOwner && !sameSite) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = Buffer.from(issue.photoData);
  const safeName = (issue.photoName || "fuel-photo").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": issue.photoMime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
