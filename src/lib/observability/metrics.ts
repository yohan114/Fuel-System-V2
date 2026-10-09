// ============================================================================
// Phase 22 — Prometheus Metrics Registry & Exposition Engine
// Reference: Fuel-System-V3 Plan Section 27 (Phase 22 — Observability)
//
// Collects counters, gauges, and histograms with label dimensions,
// serializing to standard Prometheus text exposition format (version 0.0.4).
// ============================================================================

export type MetricType = "counter" | "gauge" | "histogram";

export interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labelNames: string[];
}

function serializeLabels(labels?: Record<string, string | number>): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
  return `{${parts.join(",")}}`;
}

export class Counter {
  private values = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = []
  ) {}

  inc(labels?: Record<string, string | number>, value: number = 1): void {
    if (value < 0) throw new Error("Counter value cannot be negative");
    const key = serializeLabels(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + value);
  }

  get(labels?: Record<string, string | number>): number {
    return this.values.get(serializeLabels(labels)) || 0;
  }

  clear(): void {
    this.values.clear();
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [labels, val] of this.values.entries()) {
        lines.push(`${this.name}${labels} ${val}`);
      }
    }
    return lines.join("\n");
  }
}

export class Gauge {
  private values = new Map<string, number>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = []
  ) {}

  set(value: number, labels?: Record<string, string | number>): void {
    this.values.set(serializeLabels(labels), value);
  }

  inc(labels?: Record<string, string | number>, value: number = 1): void {
    const key = serializeLabels(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  dec(labels?: Record<string, string | number>, value: number = 1): void {
    const key = serializeLabels(labels);
    this.values.set(key, (this.values.get(key) || 0) - value);
  }

  get(labels?: Record<string, string | number>): number {
    return this.values.get(serializeLabels(labels)) || 0;
  }

  clear(): void {
    this.values.clear();
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [labels, val] of this.values.entries()) {
        lines.push(`${this.name}${labels} ${val}`);
      }
    }
    return lines.join("\n");
  }
}

export class Histogram {
  public readonly buckets: number[];
  private counts = new Map<string, number>();
  private sums = new Map<string, number>();
  private bucketCounts = new Map<string, Map<number, number>>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets?: number[],
    public readonly labelNames: string[] = []
  ) {
    this.buckets = buckets && buckets.length > 0
      ? [...buckets].sort((a, b) => a - b)
      : [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  }

  observe(value: number, labels?: Record<string, string | number>): void {
    const key = serializeLabels(labels);

    // Update count & sum
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
    this.sums.set(key, (this.sums.get(key) || 0) + value);

    // Update bucket counts
    let bMap = this.bucketCounts.get(key);
    if (!bMap) {
      bMap = new Map();
      this.bucketCounts.set(key, bMap);
    }

    for (const b of this.buckets) {
      if (value <= b) {
        bMap.set(b, (bMap.get(b) || 0) + 1);
      }
    }
  }

  clear(): void {
    this.counts.clear();
    this.sums.clear();
    this.bucketCounts.clear();
  }

  serialize(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    const keys = Array.from(this.counts.keys());
    if (keys.length === 0) {
      lines.push(`${this.name}_count 0`);
      lines.push(`${this.name}_sum 0`);
      return lines.join("\n");
    }

    for (const baseLabels of keys) {
      const bMap = this.bucketCounts.get(baseLabels) || new Map();
      const count = this.counts.get(baseLabels) || 0;
      const sum = this.sums.get(baseLabels) || 0;

      // Extract existing label key-values if any
      const rawLabels = baseLabels.length > 2 ? baseLabels.slice(1, -1) : "";

      for (const b of this.buckets) {
        const cumulativeCount = bMap.get(b) || 0;
        const bucketLabels = rawLabels
          ? `{${rawLabels},le="${b}"}`
          : `{le="${b}"}`;
        lines.push(`${this.name}_bucket${bucketLabels} ${cumulativeCount}`);
      }

      const infLabels = rawLabels ? `{${rawLabels},le="+Inf"}` : `{le="+Inf"}`;
      lines.push(`${this.name}_bucket${infLabels} ${count}`);
      lines.push(`${this.name}_sum${baseLabels} ${sum.toFixed(4)}`);
      lines.push(`${this.name}_count${baseLabels} ${count}`);
    }

    return lines.join("\n");
  }
}

export class PrometheusRegistry {
  private counters = new Map<string, Counter>();
  private gauges = new Map<string, Gauge>();
  private histograms = new Map<string, Histogram>();

  registerCounter(name: string, help: string, labelNames: string[] = []): Counter {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = new Counter(name, help, labelNames);
      this.counters.set(name, counter);
    }
    return counter;
  }

  registerGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    let gauge = this.gauges.get(name);
    if (!gauge) {
      gauge = new Gauge(name, help, labelNames);
      this.gauges.set(name, gauge);
    }
    return gauge;
  }

  registerHistogram(
    name: string,
    help: string,
    buckets?: number[],
    labelNames: string[] = []
  ): Histogram {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = new Histogram(name, help, buckets, labelNames);
      this.histograms.set(name, histogram);
    }
    return histogram;
  }

  getCounter(name: string): Counter | undefined {
    return this.counters.get(name);
  }

  getGauge(name: string): Gauge | undefined {
    return this.gauges.get(name);
  }

  getHistogram(name: string): Histogram | undefined {
    return this.histograms.get(name);
  }

  toPrometheusFormat(): string {
    const outputs: string[] = [];

    for (const c of this.counters.values()) {
      outputs.push(c.serialize());
    }
    for (const g of this.gauges.values()) {
      outputs.push(g.serialize());
    }
    for (const h of this.histograms.values()) {
      outputs.push(h.serialize());
    }

    return outputs.join("\n\n") + "\n";
  }

  clear(): void {
    for (const c of this.counters.values()) c.clear();
    for (const g of this.gauges.values()) g.clear();
    for (const h of this.histograms.values()) h.clear();
  }
}

export const defaultMetricsRegistry = new PrometheusRegistry();

// ----------------------------------------------------------------------------
// Canonical Pre-registered Enterprise ERP Metrics
// ----------------------------------------------------------------------------
export const httpRequestsTotal = defaultMetricsRegistry.registerCounter(
  "http_requests_total",
  "Total count of HTTP requests served",
  ["method", "route", "status"]
);

export const httpRequestsFailedTotal = defaultMetricsRegistry.registerCounter(
  "http_requests_failed_total",
  "Total count of HTTP requests that resulted in 4xx or 5xx errors",
  ["method", "route", "status"]
);

export const httpRequestDurationSeconds = defaultMetricsRegistry.registerHistogram(
  "http_request_duration_seconds",
  "Latency of HTTP requests in seconds",
  [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
);

export const dbQueryDurationSeconds = defaultMetricsRegistry.registerHistogram(
  "db_query_duration_seconds",
  "Database query latency in seconds",
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]
);

export const dbQueriesTotal = defaultMetricsRegistry.registerCounter(
  "db_queries_total",
  "Total number of database queries executed",
  ["model", "action"]
);

export const redisCacheHitsTotal = defaultMetricsRegistry.registerCounter(
  "redis_cache_hits_total",
  "Total number of successful Redis cache hits",
  ["cache"]
);

export const redisCacheMissesTotal = defaultMetricsRegistry.registerCounter(
  "redis_cache_misses_total",
  "Total number of Redis cache misses",
  ["cache"]
);

export const queueJobsWaitingGauge = defaultMetricsRegistry.registerGauge(
  "queue_jobs_waiting_gauge",
  "Number of jobs currently waiting in BullMQ queues",
  ["queue"]
);

export const queueJobsFailedTotal = defaultMetricsRegistry.registerCounter(
  "queue_jobs_failed_total",
  "Total number of failed background jobs",
  ["queue"]
);

export const outboxPublishedTotal = defaultMetricsRegistry.registerCounter(
  "outbox_published_total",
  "Total number of outbox events egressed to Kafka",
  ["topic"]
);

export const workflowExecutionsTotal = defaultMetricsRegistry.registerCounter(
  "workflow_executions_total",
  "Total number of durable saga workflows executed",
  ["workflow", "status"]
);
