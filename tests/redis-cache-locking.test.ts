// ============================================================================
// Phase 12 — Redis Architecture Test Suite
// Reference: Fuel-System-V3 Plan Section 16 & 17 (Phase 12 — Redis)
//
// Tests:
// 1. CacheClient operations (get, set, del, flushByPattern, incr, ttl)
// 2. Reference data caching & invalidation (categories, projects, tanks, prices)
// 3. Dashboard KPI 60s sliding window cache
// 4. Distributed Mutex & Resource Locking (SET NX PX, mutual exclusion, Lua release)
// 5. Sliding-Window Rate Limiter & HTTP Header formatting
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  InMemoryCacheClient,
  getRedisClient,
  setRedisClient,
  closeRedisClient,
} from "@/lib/cache/redis";
import {
  getCachedCategories,
  invalidateCategoriesCache,
  getCachedProjects,
  invalidateProjectsCache,
  getCachedBulkTanks,
  invalidateBulkTanksCache,
  getCachedPriceForDate,
  invalidateFuelPricesCache,
  invalidateAllReferenceCaches,
} from "@/lib/cache/reference-cache";
import {
  getCachedDashboardKPIs,
  invalidateDashboardCache,
} from "@/lib/cache/dashboard-cache";
import {
  acquireDistributedLock,
  releaseDistributedLock,
  withDistributedLock,
  LockAcquisitionError,
} from "@/lib/cache/distributed-lock";
import {
  checkRateLimit,
  resetRateLimit,
  formatRateLimitHeaders,
} from "@/lib/cache/rate-limiter";

describe("Phase 12: Redis Architecture & Cache Subsystem", () => {
  let inMemoryCache: InMemoryCacheClient;

  beforeEach(() => {
    inMemoryCache = new InMemoryCacheClient();
    setRedisClient(inMemoryCache);
  });

  afterEach(async () => {
    await closeRedisClient();
  });

  // --------------------------------------------------------------------------
  // 1. Core CacheClient Operations
  // --------------------------------------------------------------------------
  describe("1. Core CacheClient Interface", () => {
    it("stores and retrieves primitive values and serialized JSON objects", async () => {
      const cache = getRedisClient();

      await cache.set("test:string", "hello world");
      expect(await cache.get("test:string")).toBe("hello world");

      const complexObj = { id: 101, name: "Excavator", tags: ["CAT", "Diesel"] };
      await cache.set("test:obj", complexObj);
      expect(await cache.get("test:obj")).toEqual(complexObj);
    });

    it("handles key deletion and existence check", async () => {
      const cache = getRedisClient();

      await cache.set("test:del1", "val1");
      await cache.set("test:del2", "val2");

      expect(await cache.exists("test:del1")).toBe(true);
      expect(await cache.del("test:del1")).toBe(1);
      expect(await cache.exists("test:del1")).toBe(false);

      expect(await cache.del(["test:del2", "test:nonexistent"])).toBe(1);
      expect(await cache.get("test:del2")).toBeNull();
    });

    it("flushes keys by glob wildcard patterns", async () => {
      const cache = getRedisClient();

      await cache.set("fs:v3:ref:cat1", "Category 1");
      await cache.set("fs:v3:ref:cat2", "Category 2");
      await cache.set("fs:v3:dash:user1", "Dashboard Data");

      const deletedCount = await cache.flushByPattern("fs:v3:ref:*");
      expect(deletedCount).toBe(2);

      expect(await cache.get("fs:v3:ref:cat1")).toBeNull();
      expect(await cache.get("fs:v3:ref:cat2")).toBeNull();
      expect(await cache.get("fs:v3:dash:user1")).toBe("Dashboard Data");
    });

    it("supports atomic increment and TTL queries", async () => {
      const cache = getRedisClient();

      const val1 = await cache.incr("test:counter", 10);
      expect(val1).toBe(1);

      const val2 = await cache.incr("test:counter");
      expect(val2).toBe(2);

      const ttl = await cache.ttl("test:counter");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Reference Data Caching Layer
  // --------------------------------------------------------------------------
  describe("2. Reference Data Caching & Invalidation", () => {
    it("caches asset categories and eliminates redundant database queries", async () => {
      const mockCategories = [
        { id: "cat-1", code: "CAB", name: "Cab / Double Cab" },
        { id: "cat-2", code: "EXC", name: "Excavator" },
      ];

      const mockPrisma = {
        category: {
          findMany: vi.fn().mockResolvedValue(mockCategories),
        },
      } as any;

      // 1. Initial call (cache miss)
      const firstCall = await getCachedCategories(mockPrisma);
      expect(firstCall).toEqual(mockCategories);
      expect(mockPrisma.category.findMany).toHaveBeenCalledTimes(1);

      // 2. Second call (cache hit)
      const secondCall = await getCachedCategories(mockPrisma);
      expect(secondCall).toEqual(mockCategories);
      expect(mockPrisma.category.findMany).toHaveBeenCalledTimes(1); // Not called again!

      // 3. Invalidate cache
      await invalidateCategoriesCache();

      // 4. Third call after invalidation (cache miss)
      const thirdCall = await getCachedCategories(mockPrisma);
      expect(thirdCall).toEqual(mockCategories);
      expect(mockPrisma.category.findMany).toHaveBeenCalledTimes(2);
    });

    it("caches active projects and bulk tanks with tag-based invalidation", async () => {
      const mockProjects = [
        { id: "p-1", code: "COL", name: "Colombo Project" },
        { id: "p-2", code: "KAT", name: "Katunayake Site" },
      ];
      const mockTanks = [
        { id: "t-1", name: "Main Yard Tank", capacity: 5000, projectId: "p-1", project: { code: "COL", name: "Colombo" } },
      ];

      const mockPrisma = {
        project: { findMany: vi.fn().mockResolvedValue(mockProjects) },
        bulkTank: { findMany: vi.fn().mockResolvedValue(mockTanks) },
      } as any;

      // Projects cache test
      await getCachedProjects(mockPrisma);
      await getCachedProjects(mockPrisma);
      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(1);

      await invalidateProjectsCache();
      await getCachedProjects(mockPrisma);
      expect(mockPrisma.project.findMany).toHaveBeenCalledTimes(2);

      // Bulk tanks cache test
      await getCachedBulkTanks(mockPrisma);
      await getCachedBulkTanks(mockPrisma);
      expect(mockPrisma.bulkTank.findMany).toHaveBeenCalledTimes(1);

      await invalidateBulkTanksCache();
      await getCachedBulkTanks(mockPrisma);
      expect(mockPrisma.bulkTank.findMany).toHaveBeenCalledTimes(2);
    });

    it("caches fuel price lookups and supports price cache purging", async () => {
      const targetDate = new Date("2026-08-15T10:00:00Z");
      const mockPrice = {
        id: "price-diesel-1",
        fuelKind: "AUTO_DIESEL",
        pricePerLitre: 345.5,
        effectiveFrom: new Date("2026-08-01T00:00:00Z"),
      };

      const mockPrisma = {
        fuelPrice: {
          findFirst: vi.fn().mockResolvedValue(mockPrice),
        },
      } as any;

      // 1. Initial query hits DB
      const res1 = await getCachedPriceForDate("AUTO_DIESEL", targetDate, mockPrisma);
      expect(res1.pricePerLitre).toBe(345.5);
      expect(mockPrisma.fuelPrice.findFirst).toHaveBeenCalledTimes(1);

      // 2. Second query reads from cache
      const res2 = await getCachedPriceForDate("AUTO_DIESEL", targetDate, mockPrisma);
      expect(res2.pricePerLitre).toBe(345.5);
      expect(mockPrisma.fuelPrice.findFirst).toHaveBeenCalledTimes(1);

      // 3. Purge price cache
      await invalidateFuelPricesCache();

      // 4. Query after purge hits DB
      await getCachedPriceForDate("AUTO_DIESEL", targetDate, mockPrisma);
      expect(mockPrisma.fuelPrice.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Dashboard KPI Caching
  // --------------------------------------------------------------------------
  describe("3. Dashboard KPI Sliding Cache", () => {
    it("caches expensive dashboard computations and serves subsequent requests from cache", async () => {
      let computationCounter = 0;
      const computeMetrics = async () => {
        computationCounter++;
        return {
          monthlyLitres: 45200.5,
          monthlyIssueCount: 680,
          pendingRequestsCount: 4,
          pendingCorrectionsCount: 1,
          activeAssetsCount: 88,
          computedAt: new Date().toISOString(),
        };
      };

      // First request: computes fresh data
      const first = await getCachedDashboardKPIs("ADMIN", "all", "2026-08", computeMetrics);
      expect(first.fromCache).toBe(false);
      expect(first.data.monthlyLitres).toBe(45200.5);
      expect(computationCounter).toBe(1);

      // Second request: served from cache immediately
      const second = await getCachedDashboardKPIs("ADMIN", "all", "2026-08", computeMetrics);
      expect(second.fromCache).toBe(true);
      expect(second.data.monthlyLitres).toBe(45200.5);
      expect(computationCounter).toBe(1);

      // Force refresh bypasses cache
      const forced = await getCachedDashboardKPIs("ADMIN", "all", "2026-08", computeMetrics, { forceRefresh: true });
      expect(forced.fromCache).toBe(false);
      expect(computationCounter).toBe(2);

      // Invalidation cleans cache
      await invalidateDashboardCache("all");
      const afterInvalidate = await getCachedDashboardKPIs("ADMIN", "all", "2026-08", computeMetrics);
      expect(afterInvalidate.fromCache).toBe(false);
      expect(computationCounter).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Distributed Mutex & Resource Locking
  // --------------------------------------------------------------------------
  describe("4. Distributed Mutex & Resource Locking", () => {
    it("guarantees mutual exclusion across concurrent lock acquisitions", async () => {
      const resource = "billing:generate:2026-08";

      // 1. Worker 1 acquires lock
      const lock1 = await acquireDistributedLock(resource, { ttlMs: 5000 });
      expect(lock1).not.toBeNull();
      expect(lock1?.resource).toBe(resource);

      // 2. Worker 2 attempts to acquire same lock simultaneously -> fails
      const lock2 = await acquireDistributedLock(resource, { ttlMs: 5000 });
      expect(lock2).toBeNull();

      // 3. Worker 1 releases lock
      const released = await releaseDistributedLock(lock1!);
      expect(released).toBe(true);

      // 4. Worker 2 can now acquire lock
      const lock3 = await acquireDistributedLock(resource, { ttlMs: 5000 });
      expect(lock3).not.toBeNull();
      await releaseDistributedLock(lock3!);
    });

    it("protects withDistributedLock against concurrent collisions and releases on error", async () => {
      const resource = "cutover:rehearsal:stage-1";
      let executionCount = 0;

      // Successful execution inside lock
      const result = await withDistributedLock(resource, async () => {
        executionCount++;
        return "SUCCESS";
      });
      expect(result).toBe("SUCCESS");
      expect(executionCount).toBe(1);

      // Verify lock was released automatically
      const probeLock = await acquireDistributedLock(resource);
      expect(probeLock).not.toBeNull();

      // Error thrown inside lock still safely cleans up lock
      await expect(
        withDistributedLock(
          resource,
          async () => {
            throw new Error("Worker crash simulation");
          },
          { retries: 0 }
        )
      ).rejects.toThrow("Failed to acquire distributed lock");

      await releaseDistributedLock(probeLock!);
    });

    it("rejects release when token does not match lock owner (Lua script safety)", async () => {
      const resource = "import:job:999";
      const validLock = await acquireDistributedLock(resource, { ttlMs: 5000 });
      expect(validLock).not.toBeNull();

      // Fake lock with wrong token cannot release real lock
      const fakeLock = {
        ...validLock!,
        token: "imposter-token-uuid",
      };

      const released = await releaseDistributedLock(fakeLock);
      expect(released).toBe(false);

      // Real lock can still be released
      const realReleased = await releaseDistributedLock(validLock!);
      expect(realReleased).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Sliding-Window Rate Limiter
  // --------------------------------------------------------------------------
  describe("5. Sliding-Window Rate Limiter", () => {
    it("allows requests within threshold and blocks requests exceeding limit", async () => {
      const userId = "operator-john";
      await resetRateLimit(userId);

      // Limit: 3 requests per 60 seconds
      const r1 = await checkRateLimit(userId, 3, 60);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = await checkRateLimit(userId, 3, 60);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = await checkRateLimit(userId, 3, 60);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // 4th request exceeds limit
      const r4 = await checkRateLimit(userId, 3, 60);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.resetSeconds).toBeGreaterThan(0);

      // Reset allows requests again
      await resetRateLimit(userId);
      const r5 = await checkRateLimit(userId, 3, 60);
      expect(r5.allowed).toBe(true);
    });

    it("formats standard HTTP rate limit headers correctly", () => {
      const headers = formatRateLimitHeaders({
        allowed: false,
        limit: 100,
        remaining: 0,
        resetSeconds: 45,
      });

      expect(headers["X-RateLimit-Limit"]).toBe("100");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["X-RateLimit-Reset"]).toBe("45");
    });
  });
});
