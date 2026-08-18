import { NextRequest, NextResponse } from "next/server";
import { syncCeypetcoPrices } from "@/lib/prices/sync";
import { errorMessage } from "@/lib/errors";

// Daily Ceypetco price sync. The app now also runs this automatically on a
// timer (see src/instrumentation.ts); this endpoint stays so an external
// scheduler can still trigger it, e.g.
// `0 6 * * *  curl -s "https://<host>/api/cron/fuel-prices?secret=$CRON_SECRET"`.
// Idempotent — an already-stored revision is skipped and manual overrides for
// the same date are left alone.
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
    const result = await syncCeypetcoPrices();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error("Cron fuel-prices error:", err);
    return NextResponse.json({ error: errorMessage(err) || "Price sync failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
