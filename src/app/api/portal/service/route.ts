import { NextRequest, NextResponse } from "next/server";
import { getFleetServiceStatus } from "@/lib/service/fleet";

// Read-only service status for the Master Portal — exactly what the Service Planner screen
// shows: the per-asset rows and the OVERDUE / DUE_SOON / OK / UNKNOWN counts, computed on the
// higher of recorded meter growth and fuel-derived running.
//
// WorkshopOne consumes this so its Service & Filter Plan lists the machines THIS system says
// are due, rather than second-guessing them from service dates alone. It holds no meter or
// fuel data, so a machine that has barely run reads as overdue there and OK here — which is
// why the two screens disagreed (33 overdue against 46, 425 OK against 118).
//
// Token-authed via x-portal-token like the other /api/portal/* routes. Never mutates.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-portal-token");
  const expected = process.env.FUEL_PORTAL_TOKEN || process.env.PORTAL_TOKEN;
  if (!expected || !token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const asOfParam = url.searchParams.get("asOf");
  const asOf = asOfParam && !Number.isNaN(Date.parse(asOfParam)) ? new Date(asOfParam) : new Date();
  // Callers that only want the working list can ask for it, rather than pulling every row
  // and filtering at the far end.
  const only = (url.searchParams.get("state") || "").toUpperCase();
  const wanted = only ? new Set(only.split(",").map((s) => s.trim()).filter(Boolean)) : null;

  const { rows, counts } = await getFleetServiceStatus({ asOf });
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

  return NextResponse.json({
    system: "fuel",
    generatedAt: new Date().toISOString(),
    asOf: asOf.toISOString().slice(0, 10),
    counts,
    machines: rows
      .filter((r) => !wanted || wanted.has(r.state))
      .map((r) => ({
        code: r.code,
        state: r.state,
        site: r.projectName,
        category: r.categoryName,
        basis: r.basis, // HOURS or KM
        interval: r.intervalValue,
        intervalSource: r.intervalSource,
        lastServiceDate: iso(r.lastServiceDate),
        // What it has run since that service — the higher of the two measures.
        usedSince: r.usedSince,
        recordedSince: r.recordedSince,
        fuelDerivedSince: r.fuelDerivedSince,
        remaining: r.remaining,
        ratePerDay: r.ratePerDay,
        projectedDueDate: iso(r.projectedDueDate),
        hasRate: r.hasRate,
      })),
  });
}
