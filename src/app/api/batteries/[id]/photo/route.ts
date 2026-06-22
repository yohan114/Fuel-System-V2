import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Streams a battery's photo (stored inline as Bytes). Any signed-in user may view.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const battery = await prisma.battery.findUnique({
    where: { id },
    select: { photoData: true, photoMime: true, serialNo: true },
  });
  if (!battery || !battery.photoData) return new NextResponse("Not found", { status: 404 });

  const body = Buffer.from(battery.photoData);
  const safeName = (battery.serialNo || "battery").replace(/[^\w.\-]+/g, "_");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": battery.photoMime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeName}.jpg"`,
      "Cache-Control": "private, no-store",
    },
  });
}
