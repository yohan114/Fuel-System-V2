import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { openMeterOutageSchema } from "@/lib/api/schemas";
import { colomboDayKey, colomboDayStart } from "@/lib/colombo-date";
import { isSiteUser } from "@/lib/roles";
import { canUserAccessAsset } from "@/lib/assignments";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:meter-outages");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const assetId = url.searchParams.get("assetId") || "";
  const status = url.searchParams.get("status") || "all"; // "open" | "closed" | "all"
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.MeterOutageWhereInput = {};
  if (assetId) {
    where.OR = [
      { assetId },
      { asset: { code: assetId.toUpperCase() } },
    ];
  }

  if (status === "open") {
    where.endDate = null;
  } else if (status === "closed") {
    where.endDate = { not: null };
  }

  if (from || to) {
    where.startDate = {};
    if (from) where.startDate.gte = colomboDayStart(colomboDayKey(from));
    if (to) where.startDate.lte = colomboDayStart(colomboDayKey(to));
  }

  const [total, outages] = await Promise.all([
    prisma.meterOutage.count({ where }),
    prisma.meterOutage.findMany({
      where,
      skip,
      take,
      orderBy: { startDate: "desc" },
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            regNo: true,
            meterType: true,
            project: { select: { id: true, code: true, name: true } },
          },
        },
        openedBy: { select: { id: true, name: true, username: true } },
        closedBy: { select: { id: true, name: true, username: true } },
      },
    }),
  ]);

  return ok(outages, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:meter-outages");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;

  try {
    const body = await req.json();
    const parsed = openMeterOutageSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid meter outage data", 400, parsed.error.format());
    }

    const { assetId, startDate: startDateStr, reason, notes } = parsed.data;

    const asset = await prisma.asset.findFirst({
      where: {
        OR: [
          { id: assetId },
          { code: assetId.toUpperCase() },
          { regNo: assetId.toUpperCase() },
        ],
      },
    });

    if (!asset) {
      return err("NOT_FOUND", `Asset '${assetId}' not found`, 404);
    }

    // Check if asset already has an active open outage
    const existing = await prisma.meterOutage.findFirst({
      where: {
        assetId: asset.id,
        endDate: null,
      },
    });

    if (existing) {
      return err(
        "CONFLICT",
        `Asset ${asset.code} already has an active meter outage opened on ${colomboDayKey(existing.startDate)}`,
        409
      );
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to open meter outage", 403);
    }

    const startDate = startDateStr
      ? colomboDayStart(colomboDayKey(startDateStr))
      : colomboDayStart(colomboDayKey(new Date()));

    // Site-scoped users may only open outages for assets allocated to their site (Master Plan SEC-02)
    if (auth.user && isSiteUser(auth.role) && auth.user.projectId) {
      const allowed = await canUserAccessAsset(auth.user, asset.id, startDate);
      if (!allowed) {
        return err("FORBIDDEN", "This vehicle is not allocated to your site", 403);
      }
    }

    const outage = await prisma.$transaction(async (tx) => {
      const created = await tx.meterOutage.create({
        data: {
          assetId: asset.id,
          startDate,
          openedById: actorId,
          reason: notes ? `${reason} (${notes})` : reason,
        },
        include: {
          asset: { select: { id: true, code: true, regNo: true, meterType: true } },
          openedBy: { select: { id: true, name: true, username: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          action: "CREATE",
          entity: "MeterOutage",
          entityId: created.id,
          summary: `Opened meter outage for ${asset.code} via API from ${colomboDayKey(startDate)}: ${reason}`,
        },
      });

      return created;
    });

    return ok(outage, undefined, 201);
  } catch (error) {
    console.error("[api/v1/meter-outages POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to open meter outage", 500);
  }
}
