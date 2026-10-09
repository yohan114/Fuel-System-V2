// ============================================================================
// Phase 22 — Enterprise Health Check & Subsystem Readiness Probes
// Reference: Fuel-System-V3 Plan Section 27 (Phase 22 — Observability)
//
// Provides Kubernetes/Docker-compatible liveness and readiness probes
// checking database connection, Redis cache availability, and queue state.
// ============================================================================

import { getRedisClient } from "@/lib/cache/redis";
import { prisma } from "@/lib/db";

export type HealthStatus = "ok" | "degraded" | "down";

export interface ProbeResult {
  status: "ok" | "down";
  latencyMs: number;
  message?: string;
}

export interface ReadinessReport {
  status: HealthStatus;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: ProbeResult;
    redis: ProbeResult;
    memory: {
      heapUsedMb: number;
      heapTotalMb: number;
      rssMb: number;
    };
    [key: string]: any;
  };
}

export interface LivenessReport {
  status: "ok";
  uptimeSeconds: number;
  timestamp: string;
}

export class HealthCheckManager {
  private customProbes = new Map<string, () => Promise<ProbeResult>>();

  registerProbe(name: string, probe: () => Promise<ProbeResult>): void {
    this.customProbes.set(name, probe);
  }

  getLiveness(): LivenessReport {
    return {
      status: "ok",
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(
    options: {
      dbChecker?: () => Promise<void>;
    } = {}
  ): Promise<ReadinessReport> {
    const mem = process.memoryUsage();
    const checks: ReadinessReport["checks"] = {
      database: { status: "ok", latencyMs: 0 },
      redis: { status: "ok", latencyMs: 0 },
      memory: {
        heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMb: Number((mem.heapTotal / 1024 / 1024).toFixed(1)),
        rssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      },
    };

    // 1. Database Probe
    const dbStart = performance.now();
    try {
      if (options.dbChecker) {
        await options.dbChecker();
      } else {
        await prisma.$queryRaw`SELECT 1`;
      }
      checks.database = {
        status: "ok",
        latencyMs: Number((performance.now() - dbStart).toFixed(2)),
      };
    } catch (err: any) {
      checks.database = {
        status: "down",
        latencyMs: Number((performance.now() - dbStart).toFixed(2)),
        message: err?.message || String(err),
      };
    }

    // 2. Redis Probe
    const redisStart = performance.now();
    try {
      const redis = getRedisClient();
      if (!redis.isAvailable()) {
        throw new Error("Redis client is not available");
      }
      await redis.get("__health_ping__");
      checks.redis = {
        status: "ok",
        latencyMs: Number((performance.now() - redisStart).toFixed(2)),
      };
    } catch (err: any) {
      checks.redis = {
        status: "down",
        latencyMs: Number((performance.now() - redisStart).toFixed(2)),
        message: err?.message || String(err),
      };
    }

    // 3. Custom Probes
    for (const [name, probe] of this.customProbes.entries()) {
      try {
        checks[name] = await probe();
      } catch (err: any) {
        checks[name] = {
          status: "down",
          latencyMs: 0,
          message: err?.message || String(err),
        };
      }
    }

    // Determine Overall Status
    let overallStatus: HealthStatus = "ok";
    if (checks.database.status === "down") {
      overallStatus = "down"; // Database is critical
    } else if (checks.redis.status === "down") {
      overallStatus = "degraded"; // Redis is non-authoritative -> degraded
    }

    return {
      status: overallStatus,
      uptimeSeconds: Number(process.uptime().toFixed(1)),
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}

export const defaultHealthManager = new HealthCheckManager();
