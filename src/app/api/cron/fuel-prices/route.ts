import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchCeypetcoLatest } from "@/lib/prices/ceypetco";
import { fuelKindLabel } from "@/lib/fuel-kinds";

// Daily Ceypetco price sync, triggered by an external scheduler (e.g. 06:00:
// `0 6 * * *  curl -s "https://<host>/api/cron/fuel-prices?secret=$CRON_SECRET"`).
// Fetches the published price table and records one FuelPrice row per product
// per revision date (source CEYPETCO). Re-running is idempotent — the
// [fuelKind, effectiveFrom] unique key means an already-stored revision is
// skipped, and manual overrides entered later for the same date are left alone.
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
    const latest = await fetchCeypetcoLatest();
    // The price table always carries the revision date; if it ever doesn't,
    // fall back to today so the price still lands.
    const effectiveFrom = latest.effectiveFrom ?? new Date(new Date().toISOString().slice(0, 10));

    // FuelPrice.enteredBy is required — attribute automated rows to an admin.
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
    if (!admin) return NextResponse.json({ error: "No ADMIN user to attribute prices to" }, { status: 500 });

    const stored: string[] = [];
    const skipped: string[] = [];
    for (const p of latest.prices) {
      const existing = await prisma.fuelPrice.findUnique({
        where: { fuelKind_effectiveFrom: { fuelKind: p.code, effectiveFrom } },
      });
      if (existing) {
        skipped.push(p.code);
        continue;
      }
      await prisma.fuelPrice.create({
        data: {
          fuelKind: p.code,
          pricePerLitre: p.priceCents,
          effectiveFrom,
          source: "CEYPETCO",
          note: "Auto-fetched from ceypetco.gov.lk",
          enteredById: admin.id,
        },
      });
      stored.push(`${fuelKindLabel(p.code)} Rs. ${(p.priceCents / 100).toFixed(2)}`);
    }

    if (stored.length > 0) {
      await prisma.auditLog.create({
        data: {
          action: "CREATE",
          entity: "FuelPrice",
          summary: `Ceypetco price sync (${effectiveFrom.toISOString().slice(0, 10)}): ${stored.join(", ")}`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
      stored,
      skippedExisting: skipped,
    });
  } catch (err: any) {
    console.error("Cron fuel-prices error:", err);
    return NextResponse.json({ error: err.message || "Price sync failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
