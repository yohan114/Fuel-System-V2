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

const VALID_BASES = new Set(["fw", "w", "d"]);
function asBasis(b: unknown): RateBasis | null {
  return typeof b === "string" && VALID_BASES.has(b) ? (b as RateBasis) : null;
}

// Precedence for the hire basis of a bill: an explicit choice already on the
// draft wins (an admin set it, or a bulk re-cost), else the vehicle's configured
// default (a dry-hired machine bills dry automatically), else Wet.
export function resolveRateBasis(
  existingBasis: string | null | undefined,
  defaultBasis: string | null | undefined,
): RateBasis {
  return asBasis(existingBasis) ?? asBasis(defaultBasis) ?? "w";
}

// Maps an allocation's Dry/Wet hire type to a rate basis: a WET allocation bills
// the wet rate (fuel included), a DRY allocation the dry rate (fuel excluded).
// Returns undefined when the allocation carries no explicit type, so the caller
// falls back to the vehicle's own rate-card default. This is what lets a site
// that is not using the system be allocated and billed Dry or Wet by hand.
export function basisFromBillingType(billingType: string | null | undefined): RateBasis | undefined {
  return billingType === "WET" ? "w" : billingType === "DRY" ? "d" : undefined;
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
