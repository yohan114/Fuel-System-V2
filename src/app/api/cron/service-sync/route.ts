import { NextRequest, NextResponse } from "next/server";
import { syncWorkshopServices } from "@/lib/service/workshop-sync";
import { errorMessage } from "@/lib/errors";

// Pull service jobs from WorkshopOne (http://localhost:1929) into the fuel
// system. The app already runs this automatically every 5 minutes (see
// src/lib/service/workshop-scheduler.ts); this endpoint exists so it can also
// be triggered on demand — after a bulk entry in the workshop, say —
//   curl -s "http://localhost:3300/api/cron/service-sync?secret=$CRON_SECRET"
//
// Idempotent: a job already synced is left alone unless WorkshopOne changed it.
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const provided =
    request.headers.get("x-cron-secret") || request.nextUrl.searchParams.get("secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncWorkshopServices();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err: unknown) {
    console.error("Cron service-sync error:", err);
    return NextResponse.json({ error: errorMessage(err) || "Service sync failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
