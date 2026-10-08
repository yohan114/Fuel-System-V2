// ============================================================================
// Phase 2: Enterprise Pagination Contracts
// Reference: Fuel-System-V3 Plan Section 7 (Phase 2 — Pagination & Large-Data Handling)
// Standardizes 25 / 50 / 100 page sizes and cursor/offset metadata
// ============================================================================

export const DEFAULT_PAGE_SIZE = 25;
export const ALLOWED_PAGE_SIZES = [25, 50, 100] as const;
export const MAX_PAGE_SIZE = 100;

export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginationMeta {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor?: string | null;
  prevCursor?: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}
