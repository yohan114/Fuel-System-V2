import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createMeterReadingSchema } from "@/lib/api/schemas";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:readings");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.MeterReadingWhereInput = {};
  if (assetId) where.assetId = assetId;

  if (from || to) {
    where.readingDate = {};
    if (from) where.readingDate.gte = new Date(from);
    if (to) where.readingDate.lte = new Date(to);
  }

  const [total, readings] = await Promise.all([
    prisma.meterReading.count({ where }),
    prisma.meterReading.findMany({
      where,
      skip,
      take,
      orderBy: { readingDate: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true, meterType: true } },
        recordedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(readings, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:readings");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;

  try {
    const body = await req.json();
    const parsed = createMeterReadingSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid meter reading data", 400, parsed.error.format());
    }

    const { assetId, value, readingType, readingDate, notes } = parsed.data;

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return err("NOT_FOUND", "Asset not found", 404);
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to record reading", 403);
    }

    const reading = await prisma.meterReading.create({
      data: {
        assetId,
        value,
        readingType,
        readingDate: readingDate ? new Date(readingDate) : new Date(),
        source: "MANUAL",
        recordedById: actorId,
      },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "CREATE",
        entity: "MeterReading",
        entityId: reading.id,
        summary: `Recorded meter reading for ${asset.code} (${value} ${readingType}) via API`,
        metaJson: JSON.stringify({ assetId, value, readingType, readingDate }),
      },
    });

    return ok(reading, undefined, 201);
  } catch (error) {
    console.error("[api/v1/readings POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to record meter reading", 500);
  }
}
