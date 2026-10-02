import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { createDailyConditionSchema } from "@/lib/api/schemas";
import { colomboDayKey } from "@/lib/colombo-date";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const dayStr = url.searchParams.get("day") || colomboDayKey(new Date());
  const projectId = url.searchParams.get("projectId") || "";
  const status = url.searchParams.get("status") || "";

  const [colomboYear, colomboMonth, colomboDay] = dayStr.split("-").map(Number);
  const logDate = new Date(colomboYear, colomboMonth - 1, colomboDay);

  const where: Prisma.DailyConditionWhereInput = { logDate };
  if (status) where.status = status;
  if (projectId) where.asset = { projectId };

  const conditions = await prisma.dailyCondition.findMany({
    where,
    include: {
      asset: { select: { id: true, code: true, regNo: true, brand: true, model: true, projectId: true } },
      recordedBy: { select: { id: true, name: true, username: true } },
    },
    orderBy: { asset: { code: "asc" } },
  });

  return ok({
    day: dayStr,
    count: conditions.length,
    conditions,
  });
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:conditions");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;

  try {
    const body = await req.json();
    const parsed = createDailyConditionSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid condition data", 400, parsed.error.format());
    }

    const { assetId, status, note } = parsed.data;
    const dayStr = parsed.data.logDate || colomboDayKey(new Date());
    const [colomboYear, colomboMonth, colomboDay] = dayStr.split("-").map(Number);
    const logDate = new Date(colomboYear, colomboMonth - 1, colomboDay);

    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
    });

    if (!asset) {
      return err("NOT_FOUND", "Asset not found", 404);
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to record condition", 403);
    }

    // Upsert condition
    const condition = await prisma.dailyCondition.upsert({
      where: {
        assetId_logDate: {
          assetId,
          logDate,
        },
      },
      update: {
        status,
        note: note ?? undefined,
        recordedById: actorId,
      },
      create: {
        assetId,
        logDate,
        status,
        note: note ?? undefined,
        recordedById: actorId,
      },
      include: {
        asset: { select: { id: true, code: true, regNo: true } },
      },
    });

    return ok(condition, undefined, 201);
  } catch (error) {
    console.error("[api/v1/conditions POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to log daily condition", 500);
  }
}
