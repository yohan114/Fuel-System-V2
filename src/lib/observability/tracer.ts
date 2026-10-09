// ============================================================================
// Phase 22 — OpenTelemetry Distributed Tracing & W3C Trace Context
// Reference: Fuel-System-V3 Plan Section 27 (Phase 22 — Observability)
//
// Provides W3C Trace Context propagation (traceparent), span lifecycles,
// and in-memory trace collection across HTTP API, NestJS, and background queues.
// ============================================================================

import crypto from "crypto";

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}

export interface SpanStatus {
  code: "OK" | "ERROR" | "UNSET";
  message?: string;
}

export interface W3CTraceContext {
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

/**
 * Parses incoming W3C 'traceparent' header: 00-{traceId}-{parentSpanId}-{traceFlags}
 */
export function parseTraceParent(header?: string | null): W3CTraceContext | null {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4 || parts[0] !== "00") return null;

  const [_, traceId, parentSpanId, traceFlags] = parts;
  if (traceId.length !== 32 || parentSpanId.length !== 16) return null;

  return { traceId, parentSpanId, traceFlags };
}

/**
 * Formats a standard W3C 'traceparent' header string
 */
export function formatTraceParent(
  traceId: string,
  spanId: string,
  traceFlags: string = "01"
): string {
  return `00-${traceId}-${spanId}-${traceFlags}`;
}

/**
 * Generates standard OpenTelemetry compliant hexadecimal IDs
 */
export function generateTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generateSpanId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export class TraceSpan {
  public readonly traceId: string;
  public readonly spanId: string;
  public readonly parentSpanId?: string;
  public readonly startTime: number;
  public endTime?: number;
  public durationMs?: number;
  public attributes: Record<string, any> = {};
  public events: SpanEvent[] = [];
  public status: SpanStatus = { code: "UNSET" };

  private onEndCallback?: (span: TraceSpan) => void;

  constructor(
    public readonly name: string,
    options: {
      traceId?: string;
      spanId?: string;
      parentSpanId?: string;
      attributes?: Record<string, any>;
      onEnd?: (span: TraceSpan) => void;
    } = {}
  ) {
    this.traceId = options.traceId || generateTraceId();
    this.spanId = options.spanId || generateSpanId();
    this.parentSpanId = options.parentSpanId;
    this.startTime = Date.now();
    this.attributes = { ...options.attributes };
    this.onEndCallback = options.onEnd;
  }

  setAttribute(key: string, value: any): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, any>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }

  addEvent(name: string, attributes?: Record<string, any>): this {
    this.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  setStatus(code: "OK" | "ERROR", message?: string): this {
    this.status = { code, message };
    return this;
  }

  recordException(error: Error | string): this {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.setStatus("ERROR", message);
    this.addEvent("exception", {
      "exception.message": message,
      "exception.stack": stack,
    });
    return this;
  }

  end(): void {
    if (this.endTime !== undefined) return; // Already ended
    this.endTime = Date.now();
    this.durationMs = Math.max(0, this.endTime - this.startTime);
    if (this.status.code === "UNSET") {
      this.status.code = "OK";
    }

    if (this.onEndCallback) {
      this.onEndCallback(this);
    }
  }

  toTraceParent(): string {
    return formatTraceParent(this.traceId, this.spanId);
  }
}

export class EnterpriseTracer {
  private activeSpans = new Map<string, TraceSpan>();
  private completedSpans: TraceSpan[] = [];
  private maxCompletedHistory = 1000;

  startSpan(
    name: string,
    options: {
      parent?: TraceSpan | string | null;
      attributes?: Record<string, any>;
    } = {}
  ): TraceSpan {
    let traceId: string | undefined;
    let parentSpanId: string | undefined;

    if (options.parent instanceof TraceSpan) {
      traceId = options.parent.traceId;
      parentSpanId = options.parent.spanId;
    } else if (typeof options.parent === "string") {
      const parsed = parseTraceParent(options.parent);
      if (parsed) {
        traceId = parsed.traceId;
        parentSpanId = parsed.parentSpanId;
      }
    }

    const span = new TraceSpan(name, {
      traceId,
      parentSpanId,
      attributes: options.attributes,
      onEnd: (endedSpan) => {
        this.activeSpans.delete(endedSpan.spanId);
        this.completedSpans.push(endedSpan);
        if (this.completedSpans.length > this.maxCompletedHistory) {
          this.completedSpans.shift();
        }
      },
    });

    this.activeSpans.set(span.spanId, span);
    return span;
  }

  async withSpan<T>(
    name: string,
    fn: (span: TraceSpan) => Promise<T>,
    options: {
      parent?: TraceSpan | string | null;
      attributes?: Record<string, any>;
    } = {}
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus("OK");
      return result;
    } catch (err: any) {
      span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  }

  getActiveSpans(): TraceSpan[] {
    return Array.from(this.activeSpans.values());
  }

  getCompletedSpans(name?: string): TraceSpan[] {
    if (name) {
      return this.completedSpans.filter((s) => s.name === name);
    }
    return [...this.completedSpans];
  }

  clear(): void {
    this.activeSpans.clear();
    this.completedSpans = [];
  }
}

let globalTracer: EnterpriseTracer | null = null;

export function getTracer(): EnterpriseTracer {
  if (!globalTracer) {
    globalTracer = new EnterpriseTracer();
  }
  return globalTracer;
}
