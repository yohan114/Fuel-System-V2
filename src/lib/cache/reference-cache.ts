// ============================================================================
// Phase 12 — Reference Data Caching Layer
// Reference: Fuel-System-V3 Plan Section 17 (Phase 12 — Redis)
//
// Caches read-heavy, slow-moving reference metadata (Categories, Projects,
// Bulk Tanks, and Fuel Prices) to eliminate redundant SQL round-trips.
// Provides tag-based and event-driven invalidation hooks on write operations.
// ============================================================================

import { prisma as defaultPrisma } from "@/lib/db";
import { getRedisClient, CACHE_PREFIX } from "./redis";

const REF_PREFIX = `${CACHE_PREFIX}ref:`;
const DEFAULT_REF_TTL = 3600; // 1 hour

export interface CachedCategory {
  id: string;
  code: string;
  name: string;
}

export interface CachedProject {
  id: string;
  code: string;
  name: string;
}

export interface CachedBulkTank {
  id: string;
  name: string;
  capacity: number;
  projectId: string | null;
  project?: {
    code: string;
    name: string;
  } | null;
}

export interface CachedFuelPrice {
  id: string;
  fuelKind: string;
  pricePerLitre: number;
  effectiveFrom: string;
}

/**
 * Retrieves asset categories from cache, populating from DB on cache miss.
 */
export async function getCachedCategories(
  prismaClient = defaultPrisma,
  options: { forceRefresh?: boolean } = {}
): Promise<CachedCategory[]> {
  const cache = getRedisClient();
  const cacheKey = `${REF_PREFIX}categories`;

  if (!options.forceRefresh) {
    const cached = await cache.get<CachedCategory[]>(cacheKey);
    if (cached) return cached;
  }

  const fresh = await prismaClient.category.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  await cache.set(cacheKey, fresh, DEFAULT_REF_TTL);
  return fresh;
}

/**
 * Invalidates categories reference cache
 */
export async function invalidateCategoriesCache(): Promise<number> {
  const cache = getRedisClient();
  return cache.del(`${REF_PREFIX}categories`);
}

/**
 * Retrieves projects from cache, populating from DB on cache miss.
 */
export async function getCachedProjects(
  prismaClient = defaultPrisma,
  options: { forceRefresh?: boolean } = {}
): Promise<CachedProject[]> {
  const cache = getRedisClient();
  const cacheKey = `${REF_PREFIX}projects`;

  if (!options.forceRefresh) {
    const cached = await cache.get<CachedProject[]>(cacheKey);
    if (cached) return cached;
  }

  const fresh = await prismaClient.project.findMany({
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });

  await cache.set(cacheKey, fresh, DEFAULT_REF_TTL);
  return fresh;
}

/**
 * Invalidates projects reference cache
 */
export async function invalidateProjectsCache(): Promise<number> {
  const cache = getRedisClient();
  return cache.del(`${REF_PREFIX}projects`);
}

/**
 * Retrieves bulk tanks from cache, populating from DB on cache miss.
 */
export async function getCachedBulkTanks(
  prismaClient = defaultPrisma,
  options: { forceRefresh?: boolean } = {}
): Promise<CachedBulkTank[]> {
  const cache = getRedisClient();
  const cacheKey = `${REF_PREFIX}bulktanks`;

  if (!options.forceRefresh) {
    const cached = await cache.get<CachedBulkTank[]>(cacheKey);
    if (cached) return cached;
  }

  const fresh = await prismaClient.bulkTank.findMany({
    select: {
      id: true,
      name: true,
      capacity: true,
      projectId: true,
      project: { select: { code: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  await cache.set(cacheKey, fresh, DEFAULT_REF_TTL);
  return fresh;
}

/**
 * Invalidates bulk tanks reference cache
 */
export async function invalidateBulkTanksCache(): Promise<number> {
  const cache = getRedisClient();
  return cache.del(`${REF_PREFIX}bulktanks`);
}

/**
 * Retrieves authoritative fuel price for a given fuelKind and date from cache.
 * Populates from database if not cached.
 */
export async function getCachedPriceForDate(
  fuelKind: string,
  date: Date,
  prismaClient = defaultPrisma,
  options: { forceRefresh?: boolean } = {}
): Promise<{ id: string; pricePerLitre: number; effectiveFrom: Date; fuelKind: string }> {
  const cache = getRedisClient();
  const dateStr = date.toISOString().slice(0, 10);
  const cacheKey = `${REF_PREFIX}price:${fuelKind}:${dateStr}`;

  if (!options.forceRefresh) {
    const cached = await cache.get<CachedFuelPrice>(cacheKey);
    if (cached) {
      return {
        ...cached,
        effectiveFrom: new Date(cached.effectiveFrom),
      };
    }
  }

  const priceRecord = await prismaClient.fuelPrice.findFirst({
    where: {
      fuelKind,
      effectiveFrom: {
        lte: date,
      },
    },
    orderBy: {
      effectiveFrom: "desc",
    },
  });

  let record = priceRecord;
  if (!record) {
    record = await prismaClient.fuelPrice.findFirst({
      where: { fuelKind },
      orderBy: { effectiveFrom: "asc" },
    });
  }

  if (!record) {
    throw new Error(`No fuel price records found in system database for fuel kind: ${fuelKind}`);
  }

  const effectiveDate =
    record.effectiveFrom instanceof Date
      ? record.effectiveFrom
      : record.effectiveFrom
      ? new Date(record.effectiveFrom)
      : new Date();

  const formatted: CachedFuelPrice = {
    id: record.id,
    fuelKind: record.fuelKind || fuelKind,
    pricePerLitre: record.pricePerLitre,
    effectiveFrom: effectiveDate.toISOString(),
  };

  await cache.set(cacheKey, formatted, DEFAULT_REF_TTL);

  return {
    id: record.id,
    fuelKind: record.fuelKind || fuelKind,
    pricePerLitre: record.pricePerLitre,
    effectiveFrom: effectiveDate,
  };
}

/**
 * Invalidates all cached fuel prices
 */
export async function invalidateFuelPricesCache(): Promise<number> {
  const cache = getRedisClient();
  return cache.flushByPattern(`${REF_PREFIX}price:*`);
}

/**
 * Bulk invalidates all reference caches across the system
 */
export async function invalidateAllReferenceCaches(): Promise<void> {
  const cache = getRedisClient();
  await cache.flushByPattern(`${REF_PREFIX}*`);
}
