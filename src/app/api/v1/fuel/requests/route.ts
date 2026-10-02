import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createFuelRequestSchema } from "@/lib/api/schemas";
import { isSiteUser } from "@/lib/roles";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "";
  const assetId = url.searchParams.get("assetId") || "";

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.FuelRequestWhereInput = {};
  if (status) where.status = status;
  if (assetId) where.assetId = assetId;

  // Site user scoping
  if (auth.user && isSiteUser(auth.role) && auth.user.projectId) {
    where.asset = { projectId: auth.user.projectId };
  }

  const [total, requests] = await Promise.all([
    prisma.fuelRequest.count({ where }),
    prisma.fuelRequest.findMany({
      where,
      skip,
      take,
      omit: { photoData: true },
      orderBy: { createdAt: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true, meterType: true } },
        requestedBy: { select: { id: true, name: true, username: true } },
        reviewedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(requests, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:requests");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  try {
    const body = await req.json();
    const parsed = createFuelRequestSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid fuel request data", 400, parsed.error.format());
    }

    const data = parsed.data;
    const asset = await prisma.asset.findUnique({
      where: { id: data.assetId },
    });

    if (!asset) {
      return err("NOT_FOUND", "Asset not found", 404);
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to request fuel", 403);
    }

    const created = await prisma.fuelRequest.create({
      data: {
        assetId: data.assetId,
        requestedLitres: data.litres,
        meterReading: data.meterReading ?? null,
        readingType: data.readingType ?? asset.meterType,
        reason: data.purpose || data.notes || null,
        fuelKind: data.fuelKind,
        requestedById: actorId,
        status: "PENDING",
      },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
      },
    });

    return ok(created, undefined, 201);
  } catch (error) {
    console.error("[api/v1/fuel/requests POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create fuel request", 500);
  }
}
