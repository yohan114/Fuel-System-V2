import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { isSiteUser } from "@/lib/roles";
import { createAssetSchema } from "@/lib/api/schemas";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const categoryId = url.searchParams.get("categoryId") || "";
  const projectId = url.searchParams.get("projectId") || "";
  const status = url.searchParams.get("status") || "";

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.AssetWhereInput = {};

  // Site role scoping
  if (auth.user && isSiteUser(auth.user.role) && auth.user.projectId) {
    where.projectId = auth.user.projectId;
  } else if (projectId) {
    where.projectId = projectId;
  }

  if (status) {
    where.status = status;
  } else {
    where.status = { in: ["ACTIVE", "INACTIVE"] };
  }

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (q) {
    where.OR = [
      { code: { contains: q } },
      { regNo: { contains: q } },
      { brand: { contains: q } },
      { model: { contains: q } },
    ];
  }

  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      skip,
      take,
      orderBy: { code: "asc" },
      include: {
        category: { select: { id: true, code: true, name: true, defaultMeterType: true } },
        project: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  return ok(assets, paginationMeta(total, page, perPage));
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:fleet");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN" && auth.role !== "ALLOCATOR") {
    return err("FORBIDDEN", "Only admins or allocators can register assets", 403);
  }

  try {
    const body = await req.json();
    const parsed = createAssetSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid asset data", 400, parsed.error.format());
    }

    const data = parsed.data;
    const existing = await prisma.asset.findUnique({
      where: { code: data.code },
    });
    if (existing) {
      return err("CONFLICT", `Asset with code '${data.code}' already exists`, 409);
    }

    const asset = await prisma.asset.create({
      data: {
        code: data.code,
        regNo: data.regNo,
        brand: data.brand,
        model: data.model,
        yom: data.yom,
        chassisNo: data.chassisNo,
        engineNo: data.engineNo,
        meterType: data.meterType,
        categoryId: data.categoryId,
        projectId: data.projectId,
        status: data.status,
      },
      include: {
        category: true,
        project: true,
      },
    });

    return ok(asset, undefined, 201);
  } catch (error) {
    console.error("[api/v1/assets POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create asset", 500);
  }
}
