import { NextResponse } from "next/server";
import { defaultMetricsRegistry } from "@/lib/observability/metrics";

export async function GET() {
  const metricsOutput = defaultMetricsRegistry.toPrometheusFormat();

  return new NextResponse(metricsOutput, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
