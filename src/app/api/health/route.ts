import { NextResponse, type NextRequest } from "next/server";
import { defaultHealthManager } from "@/lib/observability/health";

// Public health probe for the E&C Master Portal and Kubernetes readiness/liveness probes.
// Supports ?probe=live and ?probe=ready (or ?full=true)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const probe = searchParams.get("probe") || searchParams.get("type");

  if (probe === "live") {
    const live = defaultHealthManager.getLiveness();
    return NextResponse.json(live, { status: 200 });
  }

  const report = await defaultHealthManager.getReadiness();
  const statusCode = report.status === "down" ? 503 : 200;

  if (probe === "ready" || searchParams.get("full") === "true") {
    return NextResponse.json(report, { status: statusCode });
  }

  // Default backward-compatible payload for E&C Master Portal
  return NextResponse.json(
    {
      ok: report.status !== "down",
      system: "fuel",
      version: "0.1.0",
      time: report.timestamp,
      status: report.status,
    },
    { status: statusCode }
  );
}
