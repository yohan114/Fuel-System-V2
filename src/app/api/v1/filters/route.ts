import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fleet");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const category = url.searchParams.get("category") || "";

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.FilterWhereInput = {};
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { oemPartNo: { contains: q } },
      { hifiPartNo: { contains: q } },
      { description: { contains: q } },
      { crossRefs: { some: { partNumber: { contains: q } } } },
    ];
  }

  const [total, filters] = await Promise.all([
    prisma.filter.count({ where }),
    prisma.filter.findMany({
      where,
      skip,
      take,
      include: {
        crossRefs: true,
        _count: { select: { assetLinks: true } },
      },
      orderBy: { oemPartNo: "asc" },
    }),
  ]);

  return ok(filters, paginationMeta(total, page, perPage));
}
