// ============================================================================
// Phase 22 — Enterprise Observability Test Suite
// Reference: Fuel-System-V3 Plan Section 27 (Phase 22 — Observability)
//
// Tests:
// 1. W3C Trace Context propagation and OpenTelemetry-compliant distributed tracing
// 2. Child span hierarchy and exception recording
// 3. Prometheus metrics engine: counters, gauges, histograms, and exposition format
// 4. Canonical ERP metrics aggregation
// 5. Enterprise liveness and readiness health check probes
// 6. /api/metrics and /api/health HTTP routes
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EnterpriseTracer,
  parseTraceParent,
  formatTraceParent,
  generateTraceId,
  generateSpanId,
  getTracer,
} from "@/lib/observability/tracer";
import {
  PrometheusRegistry,
  defaultMetricsRegistry,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  dbQueriesTotal,
  redisCacheHitsTotal,
  queueJobsWaitingGauge,
} from "@/lib/observability/metrics";
import {
  HealthCheckManager,
  defaultHealthManager,
} from "@/lib/observability/health";
import { setRedisClient, InMemoryCacheClient } from "@/lib/cache/redis";
import { GET as getMetricsRoute } from "@/app/api/metrics/route";
import { GET as getHealthRoute } from "@/app/api/health/route";
import { NextRequest } from "next/server";

describe("Phase 22: Enterprise Observability Subsystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRedisClient(new InMemoryCacheClient());
    defaultMetricsRegistry.clear();
  });

  // --------------------------------------------------------------------------
  // 1. W3C Trace Context & OpenTelemetry Tracer
  // --------------------------------------------------------------------------
  describe("1. W3C Trace Context & Distributed Tracing", () => {
    it("parses and formats standard W3C traceparent headers", () => {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      expect(traceId).toHaveLength(32);
      expect(spanId).toHaveLength(16);

      const header = formatTraceParent(traceId, spanId, "01");
      expect(header).toBe(`00-${traceId}-${spanId}-01`);

      const parsed = parseTraceParent(header);
      expect(parsed).toEqual({
        traceId,
        parentSpanId: spanId,
        traceFlags: "01",
      });

      expect(parseTraceParent(null)).toBeNull();
      expect(parseTraceParent("invalid-header")).toBeNull();
    });

    it("creates, annotates, and measures spans with attributes and events", async () => {
      const tracer = new EnterpriseTracer();
      const span = tracer.startSpan("process-fuel-issue", {
        attributes: { "fuel.liters": 150, "asset.id": "veh-1" },
      });

      expect(span.name).toBe("process-fuel-issue");
      expect(span.attributes["fuel.liters"]).toBe(150);
      expect(span.status.code).toBe("UNSET");

      span.addEvent("validation_passed", { verified: true });
      span.setAttribute("billing.eligible", true);

      await new Promise((r) => setTimeout(r, 15));
      span.end();

      expect(span.durationMs).toBeGreaterThanOrEqual(10);
      expect(span.status.code).toBe("OK");
      expect(span.events).toHaveLength(1);
      expect(span.events[0].name).toBe("validation_passed");

      const completed = tracer.getCompletedSpans("process-fuel-issue");
      expect(completed).toHaveLength(1);
    });

    it("propagates trace context from parent span to child spans", async () => {
      const tracer = new EnterpriseTracer();
      const parent = tracer.startSpan("http-billing-generate");

      const child = tracer.startSpan("db-query-select-assets", {
        parent,
        attributes: { "db.table": "Asset" },
      });

      expect(child.traceId).toBe(parent.traceId); // Inherits same trace ID
      expect(child.parentSpanId).toBe(parent.spanId); // Parent link established
      expect(child.spanId).not.toBe(parent.spanId); // Unique child span ID

      child.end();
      parent.end();

      expect(tracer.getCompletedSpans()).toHaveLength(2);
    });

    it("records exceptions and sets error status when withSpan catches an error", async () => {
      const tracer = new EnterpriseTracer();

      await expect(
        tracer.withSpan("faulty-operation", async (span) => {
          span.setAttribute("attempt", 1);
          throw new Error("Pessimistic lock conflict");
        })
      ).rejects.toThrow("Pessimistic lock conflict");

      const completed = tracer.getCompletedSpans("faulty-operation");
      expect(completed).toHaveLength(1);
      expect(completed[0].status.code).toBe("ERROR");
      expect(completed[0].status.message).toContain("Pessimistic lock conflict");
      expect(completed[0].events.some((e) => e.name === "exception")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Prometheus Metrics Engine
  // --------------------------------------------------------------------------
  describe("2. Prometheus Metrics Registry & Formatting", () => {
    it("increments counters with multi-dimensional labels", () => {
      const registry = new PrometheusRegistry();
      const counter = registry.registerCounter("api_requests_total", "Total requests", [
        "method",
        "status",
      ]);

      counter.inc({ method: "GET", status: 200 });
      counter.inc({ method: "GET", status: 200 }, 2);
      counter.inc({ method: "POST", status: 201 });

      expect(counter.get({ method: "GET", status: 200 })).toBe(3);
      expect(counter.get({ method: "POST", status: 201 })).toBe(1);

      const output = counter.serialize();
      expect(output).toContain('# TYPE api_requests_total counter');
      expect(output).toContain('api_requests_total{method="GET",status="200"} 3');
      expect(output).toContain('api_requests_total{method="POST",status="201"} 1');
    });

    it("tracks gauges with set, inc, and dec operations", () => {
      const registry = new PrometheusRegistry();
      const gauge = registry.registerGauge("active_pool_connections", "Connections");

      gauge.set(10);
      expect(gauge.get()).toBe(10);

      gauge.inc({}, 5);
      expect(gauge.get()).toBe(15);

      gauge.dec({}, 3);
      expect(gauge.get()).toBe(12);

      const output = gauge.serialize();
      expect(output).toContain('# TYPE active_pool_connections gauge');
      expect(output).toContain('active_pool_connections 12');
    });

    it("measures distributions in histogram buckets and calculates sum and count", () => {
      const registry = new PrometheusRegistry();
      const hist = registry.registerHistogram(
        "request_duration_seconds",
        "Duration in seconds",
        [0.05, 0.1, 0.5, 1.0]
      );

      hist.observe(0.04);
      hist.observe(0.08);
      hist.observe(0.6);

      const output = hist.serialize();
      expect(output).toContain('# TYPE request_duration_seconds histogram');
      expect(output).toContain('request_duration_seconds_bucket{le="0.05"} 1');
      expect(output).toContain('request_duration_seconds_bucket{le="0.1"} 2');
      expect(output).toContain('request_duration_seconds_bucket{le="0.5"} 2');
      expect(output).toContain('request_duration_seconds_bucket{le="1"} 3');
      expect(output).toContain('request_duration_seconds_bucket{le="+Inf"} 3');
      expect(output).toContain('request_duration_seconds_count 3');
      expect(output).toContain('request_duration_seconds_sum');
    });

    it("serializes full registry with pre-registered standard ERP metrics", () => {
      httpRequestsTotal.inc({ method: "GET", route: "/api/fuel", status: 200 }, 10);
      httpRequestDurationSeconds.observe(0.045);
      dbQueriesTotal.inc({ model: "FuelIssue", action: "create" }, 5);
      redisCacheHitsTotal.inc({ cache: "price_rule" }, 12);
      queueJobsWaitingGauge.set(4, { queue: "billing" });

      const metricsText = defaultMetricsRegistry.toPrometheusFormat();

      expect(metricsText).toContain('http_requests_total{method="GET",route="/api/fuel",status="200"} 10');
      expect(metricsText).toContain('db_queries_total{action="create",model="FuelIssue"} 5');
      expect(metricsText).toContain('redis_cache_hits_total{cache="price_rule"} 12');
      expect(metricsText).toContain('queue_jobs_waiting_gauge{queue="billing"} 4');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Health Check Subsystem
  // --------------------------------------------------------------------------
  describe("3. Health Check Probes", () => {
    it("reports liveness with uptime and timestamp", () => {
      const manager = new HealthCheckManager();
      const liveness = manager.getLiveness();

      expect(liveness.status).toBe("ok");
      expect(liveness.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(liveness.timestamp).toBeDefined();
    });

    it("reports readiness with database and redis probe latencies", async () => {
      const manager = new HealthCheckManager();
      const readiness = await manager.getReadiness({
        dbChecker: async () => {}, // Mocked fast DB ping
      });

      expect(readiness.status).toBe("ok");
      expect(readiness.checks.database.status).toBe("ok");
      expect(readiness.checks.redis.status).toBe("ok");
      expect(readiness.checks.memory.heapUsedMb).toBeGreaterThan(0);
    });

    it("reports degraded readiness when non-authoritative Redis is down", async () => {
      const manager = new HealthCheckManager();
      // Set Redis to unavailable
      setRedisClient({
        isAvailable: () => false,
      } as any);

      const readiness = await manager.getReadiness({
        dbChecker: async () => {},
      });

      expect(readiness.status).toBe("degraded");
      expect(readiness.checks.database.status).toBe("ok");
      expect(readiness.checks.redis.status).toBe("down");
    });

    it("reports down readiness when database probe fails", async () => {
      const manager = new HealthCheckManager();
      const readiness = await manager.getReadiness({
        dbChecker: async () => {
          throw new Error("Database connection pool exhausted");
        },
      });

      expect(readiness.status).toBe("down");
      expect(readiness.checks.database.status).toBe("down");
      expect(readiness.checks.database.message).toContain("Database connection pool exhausted");
    });
  });

  // --------------------------------------------------------------------------
  // 4. HTTP Routes (/api/metrics & /api/health)
  // --------------------------------------------------------------------------
  describe("4. Observability HTTP Routes", () => {
    it("GET /api/metrics serves standard Prometheus text exposition format", async () => {
      httpRequestsTotal.inc({ method: "GET", route: "/api/test", status: 200 }, 1);

      const response = await getMetricsRoute();
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/plain; version=0.0.4");

      const text = await response.text();
      expect(text).toContain('http_requests_total{method="GET",route="/api/test",status="200"} 1');
    });

    it("GET /api/health returns backward-compatible payload and supports ?probe=live and ?probe=ready", async () => {
      // 1. Backward-compatible base call
      const reqBase = new NextRequest("http://localhost:3000/api/health");
      const resBase = await getHealthRoute(reqBase);
      expect(resBase.status).toBe(200);
      const jsonBase = await resBase.json();
      expect(jsonBase.system).toBe("fuel");
      expect(jsonBase.ok).toBe(true);

      // 2. Liveness probe (?probe=live)
      const reqLive = new NextRequest("http://localhost:3000/api/health?probe=live");
      const resLive = await getHealthRoute(reqLive);
      expect(resLive.status).toBe(200);
      const jsonLive = await resLive.json();
      expect(jsonLive.status).toBe("ok");
      expect(jsonLive.uptimeSeconds).toBeDefined();

      // 3. Detailed readiness probe (?probe=ready)
      const reqReady = new NextRequest("http://localhost:3000/api/health?probe=ready");
      const resReady = await getHealthRoute(reqReady);
      expect(resReady.status).toBe(200);
      const jsonReady = await resReady.json();
      expect(jsonReady.checks).toBeDefined();
      expect(jsonReady.checks.redis).toBeDefined();
    });
  });
});
