import type { RentalRate } from "@prisma/client";
import type { BillingMode, RateBasis } from "./calc";

// Picks the rate (cents) for a mode + basis from an asset's rate card.
// Portable equipment is per-day only with a 2-tier (wet/dry) card: fw and w
// both map to the wet day rate, d maps to the dry day rate. Returns null when
// the combination is not available (caller flags "no rate").
export function pickRateCents(
  rate: RentalRate,
  mode: BillingMode,
  basis: RateBasis
): number | null {
  if (rate.equipType === "PORTABLE") {
    if (mode !== "perday") return null;
    return basis === "d" ? rate.portDdCents : rate.portDwCents;
  }

  if (mode === "hourly") {
    return basis === "fw" ? rate.hrFwCents : basis === "w" ? rate.hrWCents : rate.hrDCents;
  }
  if (mode === "perkm") {
    return basis === "fw" ? rate.kmFwCents : basis === "w" ? rate.kmWCents : rate.kmDCents;
  }
  // perday
  return basis === "fw" ? rate.dyFwCents : basis === "w" ? rate.dyWCents : rate.dyDCents;
}

// Convenience: always pick the wet rate for a given mode (for display purposes).
export function getWetRateCents(rate: RentalRate, mode: BillingMode): number | null {
  return pickRateCents(rate, mode, "w");
}

// Default billing mode for an asset: portables are day-hire; HOURS-metered
// machines bill hourly; KM-metered vehicles bill per-km.
export function defaultModeForAsset(
  meterType: string,
  equipType: string
): BillingMode {
  if (equipType === "PORTABLE") return "perday";
  return meterType === "KM" ? "perkm" : "hourly";
}
