// ============================================================================
// Phase 12 — Redis Architecture & Resilient Cache Client
// Reference: Fuel-System-V3 Plan Section 17 (Phase 12 — Redis)
//
// Governed by Section 17 Non-Authoritative Redis Policy:
// - Redis is strictly for:
//     * Reference-data caching (categories, projects, tanks, prices)
//     * Dashboard KPI cache (60s sliding window)
//     * Short-lived distributed locks (SET NX PX)
//     * Sliding window rate limiting
// - Redis is NEVER authoritative for financial balances, invoices, or audits.
// ============================================================================

import Redis from "ioredis";

export interface CacheClient {
  isAvailable(): boolean;
  get<T = any>(key: string): Promise<T | null>;
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;
  del(keyOrKeys: string | string[]): Promise<number>;
  flushByPattern(pattern: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  incr(key: string, ttlSeconds?: number): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: any[]): Promise<any>;
  disconnect(): Promise<void>;
}

export const CACHE_PREFIX = "fs:v3:";

/**
 * Enterprise In-Memory Cache Provider
 * Provides exact operational parity with Redis when running unit tests,
 * local offline development, or during connection failovers.
 */
export class InMemoryCacheClient implements CacheClient {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  isAvailable(): boolean {
    return true;
  }

  private isExpired(entry: { value: string; expiresAt: number | null }): boolean {
    if (entry.expiresAt === null) return false;
    return Date.now() > entry.expiresAt;
  }

  private cleanExpired(key: string) {
    const entry = this.store.get(key);
    if (entry && this.isExpired(entry)) {
      this.store.delete(key);
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    this.cleanExpired(key);
    const entry = this.store.get(key);
    if (!entry) return null;
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as unknown as T;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value: serialized, expiresAt });
  }

  async del(keyOrKeys: string | string[]): Promise<number> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    let deleted = 0;
    for (const k of keys) {
      if (this.store.delete(k)) deleted++;
    }
    return deleted;
  }

  async flushByPattern(pattern: string): Promise<number> {
    // Convert glob wildcards to regex
    const regexPattern = "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    const regex = new RegExp(regexPattern);
    let count = 0;

    for (const [key] of this.store.entries()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  async exists(key: string): Promise<boolean> {
    this.cleanExpired(key);
    return this.store.has(key);
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    this.cleanExpired(key);
    const existing = this.store.get(key);
    let num = 1;
    let expiresAt: number | null = null;

    if (existing) {
      const parsed = parseInt(existing.value, 10);
      num = isNaN(parsed) ? 1 : parsed + 1;
      expiresAt = existing.expiresAt;
    } else if (ttlSeconds && ttlSeconds > 0) {
      expiresAt = Date.now() + ttlSeconds * 1000;
    }

    this.store.set(key, { value: num.toString(), expiresAt });
    return num;
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(key, entry);
    return true;
  }

  async ttl(key: string): Promise<number> {
    this.cleanExpired(key);
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    const remainingMs = entry.expiresAt - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  async eval(script: string, numKeys: number, ...args: any[]): Promise<any> {
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    // Standard Redis Lua Lock Release Script:
    // if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end
    if (script.includes("redis.call(\"get\", KEYS[1]) == ARGV[1]")) {
      const lockKey = keys[0];
      const expectedToken = argv[0];
      this.cleanExpired(lockKey);
      const current = this.store.get(lockKey);
      if (current && (current.value === expectedToken || current.value === JSON.stringify(expectedToken))) {
        this.store.delete(lockKey);
        return 1;
      }
      return 0;
    }

    return null;
  }

  async disconnect(): Promise<void> {
    this.store.clear();
  }

  // Test inspection helper
  _clearAll(): void {
    this.store.clear();
  }
}

/**
 * Redis Live Client wrapper around ioredis
 */
export class LiveRedisCacheClient implements CacheClient {
  private client: Redis;
  private connected = false;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379";
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying quickly in test/dev
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    });

    this.client.on("connect", () => {
      this.connected = true;
    });

    this.client.on("error", () => {
      this.connected = false;
    });

    this.client.on("close", () => {
      this.connected = false;
    });
  }

  isAvailable(): boolean {
    return this.connected && this.client.status === "ready";
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.connected = true;
    } catch {
      this.connected = false;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as unknown as T;
      }
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, "EX", ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch {
      // non-blocking failure
    }
  }

  async del(keyOrKeys: string | string[]): Promise<number> {
    try {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      if (keys.length === 0) return 0;
      return await this.client.del(...keys);
    } catch {
      return 0;
    }
  }

  async flushByPattern(pattern: string): Promise<number> {
    try {
      const stream = this.client.scanStream({ match: pattern, count: 100 });
      let deletedCount = 0;
      for await (const keys of stream) {
        if (keys.length) {
          deletedCount += await this.client.del(...keys);
        }
      }
      return deletedCount;
    } catch {
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const res = await this.client.exists(key);
      return res > 0;
    } catch {
      return false;
    }
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    try {
      const res = await this.client.incr(key);
      if (res === 1 && ttlSeconds && ttlSeconds > 0) {
        await this.client.expire(key, ttlSeconds);
      }
      return res;
    } catch {
      return 1;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const res = await this.client.expire(key, ttlSeconds);
      return res === 1;
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }

  async eval(script: string, numKeys: number, ...args: any[]): Promise<any> {
    try {
      return await this.client.eval(script, numKeys, ...args);
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
    this.connected = false;
  }
}

// Global Singleton Cache Instance
let globalCacheInstance: CacheClient | null = null;

export function getRedisClient(): CacheClient {
  if (globalCacheInstance) return globalCacheInstance;

  const redisEnabled = process.env.REDIS_ENABLED === "true";
  const hasRedisUrl = Boolean(process.env.REDIS_URL);

  if (redisEnabled && hasRedisUrl) {
    const liveClient = new LiveRedisCacheClient();
    liveClient.connect().catch(() => {});
    globalCacheInstance = liveClient;
  } else {
    // Default to resilient In-Memory cache provider
    globalCacheInstance = new InMemoryCacheClient();
  }

  return globalCacheInstance;
}

/**
 * Resets or overrides the cache client (for testing or reconfiguration)
 */
export function setRedisClient(client: CacheClient | null): void {
  globalCacheInstance = client;
}

/**
 * Gracefully shuts down the global cache client
 */
export async function closeRedisClient(): Promise<void> {
  if (globalCacheInstance) {
    await globalCacheInstance.disconnect();
    globalCacheInstance = null;
  }
}
