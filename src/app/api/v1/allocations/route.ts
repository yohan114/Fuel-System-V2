import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";
import { parsePagination, paginationMeta } from "@/lib/api/pagination";
import { currentMonthPeriod } from "@/lib/billing/period";
import type { Prisma } from "@prisma/client";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:assignments");
  if ("error" in authResult) return authResult.error;

  const url = new URL(req.url);
  const ym = url.searchParams.get("ym") || currentMonthPeriod().periodKey;
  const projectId = url.searchParams.get("projectId");
  const assetId = url.searchParams.get("assetId");
  const q = url.searchParams.get("q")?.trim();

  const { page, perPage, skip, take } = parsePagination(req);

  const where: Prisma.VehicleAllocationWhereInput = { month: ym };
  if (projectId) where.projectId = projectId;
  if (assetId) where.assetId = assetId;
  if (q) {
    where.OR = [
      { vehicleNo: { contains: q } },
      { siteName: { contains: q } },
      { machineType: { contains: q } },
    ];
  }

  const [total, allocations] = await Promise.all([
    prisma.vehicleAllocation.count({ where }),
    prisma.vehicleAllocation.findMany({
      where,
      skip,
      take,
      orderBy: [{ siteName: "asc" }, { vehicleNo: "asc" }],
      include: {
        asset: { select: { id: true, code: true, regNo: true, meterType: true } },
        project: { select: { id: true, name: true, code: true } },
      },
    }),
  ]);

  return ok(allocations, paginationMeta(total, page, perPage));
}
