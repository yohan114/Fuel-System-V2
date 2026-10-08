// ============================================================================
// Phase 1/2: Fleet Assets Query Engine with Narrow Projections & Pagination
// Reference: Fuel-System-V3 Plan Sections 6, 7 (N+1 Elimination & Pagination)
// ============================================================================

import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { isSiteUser } from "@/lib/roles";
import {
  normalizePaginationParams,
  buildPaginationMeta,
} from "@/lib/pagination/paginate";
import { PaginatedResult } from "@/lib/pagination/types";
import { recordRouteLatency } from "@/lib/observability/timing";

export interface FleetAssetRowItem {
  id: string;
  code: string;
  regNo: string | null;
  brand: string | null;
  model: string | null;
  site: string | null;
  meterType: string;
  status: string;
  category: {
    id: string;
    code: string;
    name: string;
  };
}

export interface GetFleetAssetsOptions {
  q?: string;
  categoryCode?: string;
  projectId?: string | null;
  role?: string;
  page?: number | string | null;
  limit?: number | string | null;
}

/**
 * Executes a paginated, narrowly-projected query for fleet assets.
 * Eliminates unbounded table reads and applies server-side filtering.
 */
export async function getFleetAssetsPaginated(
  options: GetFleetAssetsOptions
): Promise<PaginatedResult<FleetAssetRowItem>> {
  const startPerf = performance.now();
  const { page, limit, skip } = normalizePaginationParams({
    page: options.page,
    limit: options.limit,
  });

  const where: Prisma.AssetWhereInput = {
    status: {
      in: ["ACTIVE", "INACTIVE"],
    },
    ...(isSiteUser(options.role) && options.projectId
      ? { projectId: options.projectId }
      : {}),
  };

  if (options.categoryCode) {
    where.category = {
      code: options.categoryCode,
    };
  }

  if (options.q && options.q.trim()) {
    const search = options.q.trim();
    where.OR = [
      { code: { contains: search } },
      { brand: { contains: search } },
      { model: { contains: search } },
      { regNo: { contains: search } },
      { site: { contains: search } },
    ];
  }

  const [totalCount, assets] = await prisma.$transaction([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      skip,
      take: limit,
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        regNo: true,
        brand: true,
        model: true,
        site: true,
        meterType: true,
        status: true,
        category: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const durationMs = performance.now() - startPerf;
  recordRouteLatency("fleet_assets_paginated", durationMs);

  return {
    data: assets,
    pagination: buildPaginationMeta(totalCount, page, limit),
  };
}
