import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { createServiceRecordSchema } from "@/lib/api/schemas";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") || "";
  const type = url.searchParams.get("type") || "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.ServiceRecordWhereInput = {};
  if (assetId) where.assetId = assetId;
  if (type) where.serviceType = type;

  if (from || to) {
    where.serviceDate = {};
    if (from) where.serviceDate.gte = new Date(from);
    if (to) where.serviceDate.lte = new Date(to);
  }

  const [total, services] = await Promise.all([
    prisma.serviceRecord.count({ where }),
    prisma.serviceRecord.findMany({
      where,
      skip,
      take,
      orderBy: { serviceDate: "desc" },
      include: {
        asset: { select: { id: true, code: true, regNo: true, brand: true, model: true } },
        recordedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(services, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:services");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;

  try {
    const body = await req.json();
    const parsed = createServiceRecordSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid service record data", 400, parsed.error.format());
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
      return err("FORBIDDEN", "No user available to record service", 403);
    }

    const service = await prisma.serviceRecord.create({
      data: {
        assetId: data.assetId,
        serviceDate: data.serviceDate ? new Date(data.serviceDate) : new Date(),
        serviceType: data.serviceType,
        meterType: asset.meterType,
        meterAtService: data.meterAtService ?? null,
        costCents: data.costCents ?? 0,
        note: data.description ?? null,
        location: data.performedBy ?? null,
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
        entity: "ServiceRecord",
        entityId: service.id,
        summary: `Created service record for ${asset.code} (${data.serviceType}) via API`,
        metaJson: JSON.stringify({
          serviceType: data.serviceType,
          meterAtService: data.meterAtService,
          costCents: data.costCents ?? 0,
        }),
      },
    });

    return ok(service, undefined, 201);
  } catch (error) {
    console.error("[api/v1/services POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create service record", 500);
  }
}
