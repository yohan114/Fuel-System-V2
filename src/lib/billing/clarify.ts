import { VARIANCE_THRESHOLD, formatVariancePct } from "../reports/recommended";

// Reasons a draft bill should be clarified before it is issued. Pure so it can
// gate the finalize action and be unit-tested. Two checks:
//   1. the fuel-implied running disagrees with the recorded chart by ≥20%
//      (same rule as the /billing "CLARIFY" chip), and
//   2. fuel was issued but priced at Rs 0 (the fuel line would be zero).
// An empty array means the bill is safe to issue without an override.

export interface ClarifyInput {
  billingMode: string;
  rateBasis: string;
  fuelLitres: number;
  fuelCostCents: number;
  actualUnits: number;
  actualMeterUnits: number | null;
  derivedStandardUnits: number | null;
  derivedFromFuel: boolean;
}

export function billClarifyReasons(b: ClarifyInput): string[] {
  const reasons: string[] = [];

  const metered = b.billingMode === "hourly" || b.billingMode === "perkm";
  if (metered && b.derivedStandardUnits != null) {
    const actual = b.actualMeterUnits ?? (b.derivedFromFuel ? 0 : b.actualUnits);
    const variance = (b.derivedStandardUnits - actual) / Math.max(actual, 1);
    if (Math.abs(variance) >= VARIANCE_THRESHOLD) {
      const unit = b.billingMode === "perkm" ? "km" : "hr";
      reasons.push(
        `Fuel implies ~${b.derivedStandardUnits.toFixed(0)} ${unit} but the chart shows ${actual.toFixed(0)} ${unit} (${formatVariancePct(variance)}) — confirm the running chart with the site.`
      );
    }
  }

  const chargesFuel = b.rateBasis === "fw" || b.rateBasis === "w";
  if (chargesFuel && b.fuelLitres > 0 && b.fuelCostCents <= 0) {
    reasons.push(`Fuel was issued (${b.fuelLitres.toFixed(0)} L) but priced at Rs 0 — set the fuel price so the fuel line isn't zero.`);
  }

  return reasons;
}
