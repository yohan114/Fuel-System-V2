import { NextResponse } from "next/server";
import { requireApi } from "@/lib/api/auth";
import { prisma } from "@/lib/db";
import { err } from "@/lib/api/respond";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;
  const issue = await prisma.fuelIssue.findUnique({
    where: { id },
    select: {
      photoData: true,
      photoMime: true,
      photoName: true,
    },
  });

  if (!issue || !issue.photoData) {
    return err("NOT_FOUND", "Photo not found for this fuel issue", 404);
  }

  const body = Buffer.from(issue.photoData);
  const safeName = (issue.photoName || "fuel-photo.jpg").replace(/[^\w.\-]+/g, "_");

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": issue.photoMime || "image/jpeg",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=86400",
    },
  });
}
