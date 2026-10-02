export interface PaginationParams {
  page: number;
  perPage: number;
  skip: number;
  take: number;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  [key: string]: unknown;
}

export function parsePagination(req: Request, defaultLimit = 20, maxLimit = 100): PaginationParams {
  const url = new URL(req.url);
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const limitParam = parseInt(
    url.searchParams.get("per_page") ||
    url.searchParams.get("perPage") ||
    url.searchParams.get("limit") ||
    String(defaultLimit),
    10
  );

  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const perPage = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, maxLimit)
    : defaultLimit;

  return {
    page,
    perPage,
    skip: (page - 1) * perPage,
    take: perPage,
  };
}

export function paginationMeta(total: number, page: number, perPage: number): PaginationMeta {
  const total_pages = Math.ceil(total / perPage) || 1;
  return {
    page,
    per_page: perPage,
    total,
    total_pages,
    has_next: page < total_pages,
    has_prev: page > 1,
  };
}
