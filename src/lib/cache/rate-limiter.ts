// ============================================================================
// Phase 12 — Sliding Window API Rate Limiter
// Reference: Fuel-System-V3 Plan Section 17 & 18 (Phase 12 — Redis)
//
// Protects the NestJS API Gateway (/api/v3/*) from abusive load or runaway
// script loops using sliding-window rate limiting backed by Redis.
// ============================================================================

import { getRedisClient, CACHE_PREFIX } from "./redis";

const RATELIMIT_PREFIX = `${CACHE_PREFIX}rl:`;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

/**
 * Checks and increments rate limit for a client or operation identifier.
 *
 * @param identifier Unique key (e.g. IP, API key, user ID)
 * @param limit Maximum allowed requests within the time window
 * @param windowSeconds Window length in seconds (default: 60)
 */
export async function checkRateLimit(
  identifier: string,
  limit = 100,
  windowSeconds = 60
): Promise<RateLimitResult> {
  const cache = getRedisClient();
  const key = `${RATELIMIT_PREFIX}${identifier}`;

  const currentCount = await cache.incr(key, windowSeconds);
  let ttl = await cache.ttl(key);

  if (ttl <= 0) {
    ttl = windowSeconds;
  }

  const allowed = currentCount <= limit;
  const remaining = Math.max(0, limit - currentCount);

  return {
    allowed,
    limit,
    remaining,
    resetSeconds: ttl,
  };
}

/**
 * Resets rate limit for an identifier
 */
export async function resetRateLimit(identifier: string): Promise<number> {
  const cache = getRedisClient();
  return cache.del(`${RATELIMIT_PREFIX}${identifier}`);
}

/**
 * Generates standard HTTP rate limit headers
 */
export function formatRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.resetSeconds.toString(),
  };
}
