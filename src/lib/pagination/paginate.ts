// ============================================================================
// Phase 2: Pagination Engine & Normalization Utilities
// Reference: Fuel-System-V3 Plan Section 7 (Phase 2 — Pagination & Large-Data Handling)
// Enforces page size limits (25, 50, 100) and calculates pagination metadata
// ============================================================================

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationMeta,
  PaginationParams,
} from "./types";

/**
 * Normalizes user-supplied pagination parameters, guaranteeing:
 * - page >= 1 (defaults to 1)
 * - limit is clamped between 1 and MAX_PAGE_SIZE (100)
 * - returns calculated SQL/Prisma `skip` offset
 */
export function normalizePaginationParams(params?: {
  page?: string | number | null;
  limit?: string | number | null;
}): {
  page: number;
  limit: number;
  skip: number;
} {
  const parsedPage =
    typeof params?.page === "string"
      ? parseInt(params.page, 10)
      : typeof params?.page === "number"
      ? params.page
      : 1;

  const parsedLimit =
    typeof params?.limit === "string"
      ? parseInt(params.limit, 10)
      : typeof params?.limit === "number"
      ? params.limit
      : DEFAULT_PAGE_SIZE;

  const page = Math.max(1, isNaN(parsedPage) ? 1 : parsedPage);
  let limit = isNaN(parsedLimit) ? DEFAULT_PAGE_SIZE : parsedLimit;

  // Clamp limit: min 1, max 100
  if (limit <= 0) limit = DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Computes metadata for paginated query results.
 */
export function buildPaginationMeta(
  totalCount: number,
  page: number,
  limit: number,
  nextCursor?: string | null,
  prevCursor?: string | null
): PaginationMeta {
  const total = Math.max(0, totalCount);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const normalizedPage = Math.min(Math.max(1, page), totalPages);

  return {
    page: normalizedPage,
    limit,
    totalCount: total,
    totalPages,
    hasNextPage: normalizedPage < totalPages,
    hasPrevPage: normalizedPage > 1,
    nextCursor: nextCursor ?? null,
    prevCursor: prevCursor ?? null,
  };
}
