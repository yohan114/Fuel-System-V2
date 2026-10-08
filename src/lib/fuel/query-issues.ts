// ============================================================================
// Phase 1 & 2: Optimized Paginated Fuel Issues Query Engine
// Reference: Fuel-System-V3 Plan Section 6 (Phase 1 — N+1 & Over-fetching)
// and Section 7 (Phase 2 — Pagination & Large-Data Handling)
//
// Key Optimizations:
// 1. Strict pagination: limit clamped to 25 / 50 / 100 (never 20,000 uncapped).
// 2. Narrow projections: selects only required display fields, avoiding relation bloat.
// 3. Page-scoped attribution: resolves asset assignments only for the active page's assets.
// 4. Parallel execution: queries page items and total count concurrently.
// ============================================================================

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { normalizePaginationParams, buildPaginationMeta } from "@/lib/pagination/paginate";
import type { PaginatedResult } from "@/lib/pagination/types";
import { indexAssignments, assignedSiteOn } from "@/lib/fuel/site-attribution";

export interface FuelIssueRowItem {
  id: string;
  issueDate: Date;
  litres: number;
  fuelKind: string;
  source: string;
  voided: boolean;
  meterReading: number | null;
  readingType: string | null;
  correctionRequested: boolean;
  asset: {
    id: string;
    code: string;
    regNo: string | null;
    category: string | null;
    projectId: string | null;
    projectName: string | null;
  };
  bulkTank: {
    id: string;
    name: string;
    projectId: string | null;
  } | null;
  issuedBy: {
    id: string;
    name: string;
    username: string;
  } | null;
  attributedSiteName: string | null;
  attributedSiteCode: string | null;
}

export interface GetFuelIssuesOptions {
  where?: Prisma.FuelIssueWhereInput;
  page?: string | number | null;
  limit?: string | number | null;
}

/**
 * Fetches a single page of fuel issues with narrow projections and page-scoped site attribution.
 */
export async function getFuelIssuesPaginated(
  options: GetFuelIssuesOptions = {}
): Promise<PaginatedResult<FuelIssueRowItem>> {
  const { page, limit, skip } = normalizePaginationParams({
    page: options.page,
    limit: options.limit,
  });

  const where = options.where || {};

  // Execute items query and total count in parallel
  const [rawIssues, totalCount] = await Promise.all([
    prisma.fuelIssue.findMany({
      where,
      skip,
      take: limit,
      orderBy: { issueDate: "desc" },
      select: {
        id: true,
        issueDate: true,
        litres: true,
        fuelKind: true,
        source: true,
        voided: true,
        meterReading: true,
        readingType: true,
        corrections: {
          where: { status: "PENDING" },
          select: { id: true },
        },
        bulkTankId: true,
        assetId: true,
        asset: {
          select: {
            id: true,
            code: true,
            regNo: true,
            category: { select: { name: true, code: true } },
            projectId: true,
            project: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        bulkTank: {
          select: {
            id: true,
            name: true,
            projectId: true,
            project: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        issuedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    }),
    prisma.fuelIssue.count({ where }),
  ]);

  // Page-scoped site attribution: resolve assignments ONLY for unique asset IDs on this page
  const pageAssetIds = [...new Set(rawIssues.map((i) => i.assetId))];
  const assignments =
    pageAssetIds.length > 0
      ? await prisma.assetAssignment.findMany({
          where: { assetId: { in: pageAssetIds } },
          select: { assetId: true, projectId: true, startDate: true, endDate: true },
        })
      : [];

  const attributionIdx = indexAssignments(assignments);

  // Map into flattened row items
  const data: FuelIssueRowItem[] = rawIssues.map((issue) => {
    // Cascade: 1. Assignment on issue date -> 2. Bulk tank site -> 3. Vehicle static project
    const assignedProjectId = assignedSiteOn(attributionIdx, issue.assetId, issue.issueDate);
    
    let siteName = issue.asset.project?.name ?? null;
    let siteCode = issue.asset.project?.code ?? null;

    if (assignedProjectId && issue.asset.project && issue.asset.project.id === assignedProjectId) {
      siteName = issue.asset.project.name;
      siteCode = issue.asset.project.code;
    } else if (issue.bulkTank?.project) {
      siteName = issue.bulkTank.project.name;
      siteCode = issue.bulkTank.project.code;
    }

    return {
      id: issue.id,
      issueDate: issue.issueDate,
      litres: issue.litres,
      fuelKind: issue.fuelKind,
      source: issue.source,
      voided: issue.voided,
      meterReading: issue.meterReading,
      readingType: issue.readingType,
      correctionRequested: issue.corrections.length > 0,
      asset: {
        id: issue.asset.id,
        code: issue.asset.code,
        regNo: issue.asset.regNo,
        category: issue.asset.category?.name ?? issue.asset.category?.code ?? null,
        projectId: issue.asset.projectId,
        projectName: issue.asset.project?.name ?? null,
      },
      bulkTank: issue.bulkTank
        ? {
            id: issue.bulkTank.id,
            name: issue.bulkTank.name,
            projectId: issue.bulkTank.projectId,
          }
        : null,
      issuedBy: issue.issuedBy,
      attributedSiteName: siteName,
      attributedSiteCode: siteCode,
    };
  });

  const pagination = buildPaginationMeta(totalCount, page, limit);

  return {
    data,
    pagination,
  };
}
