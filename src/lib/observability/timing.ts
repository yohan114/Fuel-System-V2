// ============================================================================
// Phase 0: Performance Baseline & Request Timing Instrumentation
// Reference: Fuel-System-V3 Plan Section 5 (Phase 0 — Performance Baseline)
// Tracks p50, p95, p99 latencies and emits standard Server-Timing headers
// ============================================================================

export interface RouteTimingMetrics {
  route: string;
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  lastUpdated: Date;
}

const MAX_SAMPLES = 500;
const routeTimingsMap = new Map<string, number[]>();

/**
 * Records a measured duration for a given route/operation.
 */
export function recordRouteLatency(route: string, durationMs: number): void {
  let samples = routeTimingsMap.get(route);
  if (!samples) {
    samples = [];
    routeTimingsMap.set(route, samples);
  }
  samples.push(durationMs);
  if (samples.length > MAX_SAMPLES) {
    samples.shift(); // Keep rolling window
  }
}

/**
 * Calculates percentile for sorted numerical array.
 */
function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

/**
 * Retrieves summary metrics (count, p50, p95, p99) for a route or all routes.
 */
export function getRouteLatencyMetrics(route?: string): RouteTimingMetrics[] {
  const routes = route ? [route] : Array.from(routeTimingsMap.keys());
  const metrics: RouteTimingMetrics[] = [];

  for (const r of routes) {
    const samples = routeTimingsMap.get(r);
    if (!samples || samples.length === 0) continue;

    const sorted = [...samples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);

    metrics.push({
      route: r,
      count: sorted.length,
      minMs: Number(sorted[0].toFixed(2)),
      maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
      avgMs: Number((sum / sorted.length).toFixed(2)),
      p50Ms: Number(calculatePercentile(sorted, 50).toFixed(2)),
      p95Ms: Number(calculatePercentile(sorted, 95).toFixed(2)),
      p99Ms: Number(calculatePercentile(sorted, 99).toFixed(2)),
      lastUpdated: new Date(),
    });
  }

  return metrics;
}

/**
 * Clears recorded samples (used for testing and fresh benchmarks).
 */
export function clearRouteLatencyMetrics(): void {
  routeTimingsMap.clear();
}

/**
 * Measures the execution time of an asynchronous function.
 */
export async function measureAsync<T>(
  name: string,
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = Number((performance.now() - start).toFixed(2));
    recordRouteLatency(name, durationMs);
    return { result, durationMs };
  } catch (err) {
    const durationMs = Number((performance.now() - start).toFixed(2));
    recordRouteLatency(`${name}:error`, durationMs);
    throw err;
  }
}

/**
 * Formats a standard W3C Server-Timing header string.
 * Example: `app;dur=24.5, db;dur=12.1`
 */
export function formatServerTiming(metrics: Record<string, number | { dur: number; desc?: string }>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") {
      parts.push(`${key};dur=${value.toFixed(1)}`);
    } else {
      const descPart = value.desc ? `;desc="${value.desc}"` : "";
      parts.push(`${key};dur=${value.dur.toFixed(1)}${descPart}`);
    }
  }
  return parts.join(", ");
}
