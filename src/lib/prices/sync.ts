import { prisma } from "@/lib/db";
import { fetchCeypetcoLatest } from "@/lib/prices/ceypetco";
import { fuelKindLabel } from "@/lib/fuel-kinds";

// Fetch the latest Ceypetco revision and store one FuelPrice row per product
// (source CEYPETCO). Idempotent: the [fuelKind, effectiveFrom] unique key means
// an already-stored revision is skipped, and a manual override for the same date
// is left untouched. Shared by the /api/cron/fuel-prices endpoint and the in-app
// daily scheduler so both behave identically.

export interface PriceSyncResult {
  effectiveFrom: string; // YYYY-MM-DD
  stored: string[];
  skippedExisting: string[];
}

export async function syncCeypetcoPrices(): Promise<PriceSyncResult> {
  const latest = await fetchCeypetcoLatest();
  // The table always carries the revision date; fall back to today so the price
  // still lands if it ever doesn't.
  const effectiveFrom = latest.effectiveFrom ?? new Date(new Date().toISOString().slice(0, 10));

  // FuelPrice.enteredBy is required — attribute automated rows to an admin.
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) throw new Error("No ADMIN user to attribute prices to");

  const stored: string[] = [];
  const skippedExisting: string[] = [];
  for (const p of latest.prices) {
    const existing = await prisma.fuelPrice.findUnique({
      where: { fuelKind_effectiveFrom: { fuelKind: p.code, effectiveFrom } },
    });
    if (existing) {
      skippedExisting.push(p.code);
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

  return { effectiveFrom: effectiveFrom.toISOString().slice(0, 10), stored, skippedExisting };
}
