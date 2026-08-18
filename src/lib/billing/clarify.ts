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
  /**
   * The standard consumption on the bill, as snapshotted at generation.
   * Its magnitude identifies its basis: litres-per-km values are all below 1
   * (max 0.455 across the fleet) and litres-per-hour all above (min 4.0), so a
   * band quoted in the wrong unit for this billing mode is detectable from the
   * stored bill alone, with no extra column.
   */
  fuelConsTypSnapshot?: number | null;
}

/** True when the snapshotted band is quoted in a unit this mode cannot bill. */
function bandNotComparable(b: ClarifyInput): boolean {
  if (b.fuelConsTypSnapshot == null || b.fuelConsTypSnapshot <= 0) return false;
  const bandIsPerKm = b.fuelConsTypSnapshot < 1;
  if (b.billingMode === "perkm") return !bandIsPerKm;
  if (b.billingMode === "hourly") return bandIsPerKm;
  return false;
}

/** True when the monthly ceiling clipped the units below what fuel implied. */
function wasCapped(b: ClarifyInput): boolean {
  if (!b.derivedFromFuel || b.derivedStandardUnits == null) return false;
  return b.actualUnits < b.derivedStandardUnits - 0.5;
}

export function billClarifyReasons(b: ClarifyInput): string[] {
  const reasons: string[] = [];
  const unit = b.billingMode === "perkm" ? "km" : "hr";

  const metered = b.billingMode === "hourly" || b.billingMode === "perkm";

  // Billing on fuel alone. The meter is the only independent measurement of
  // work, so when it never moved the charge rests entirely on the fuel register
  // and a class-average consumption figure. That must be looked at before it is
  // invoiced — it is precisely the population with no evidence behind it.
  if (metered && b.derivedFromFuel && (b.actualMeterUnits ?? 0) <= 0) {
    reasons.push(
      `Billed on fuel alone (${b.fuelLitres.toFixed(0)} L → ${b.actualUnits.toFixed(0)} ${unit}) — the meter never moved this month, so nothing independently confirms the work.`
    );
  }

  // The two independent measurements disagree. This no longer decides which one
  // is billed, but it stays as a brake: without it, rental becomes a straight
  // multiple of the fuel register and a mis-keyed litre invoices the client.
  if (metered && b.derivedStandardUnits != null) {
    const actual = b.actualMeterUnits ?? (b.derivedFromFuel ? 0 : b.actualUnits);
    if (actual > 0) {
      const variance = (b.derivedStandardUnits - actual) / Math.max(actual, 1);
      if (Math.abs(variance) >= VARIANCE_THRESHOLD) {
        reasons.push(
          `Fuel implies ~${b.derivedStandardUnits.toFixed(0)} ${unit} but the chart shows ${actual.toFixed(0)} ${unit} (${formatVariancePct(variance)}) — confirm the running chart with the site.`
        );
      }
    }
  }

  // An hour band on a km meter, or the reverse. Billing falls back to the meter
  // for these, but that meter is exactly the one the rate sheet says is the
  // wrong instrument — so the units must not be trusted silently.
  if (metered && bandNotComparable(b)) {
    reasons.push(
      `The rate card's standard consumption is quoted per ${unit === "km" ? "hour" : "kilometre"} but this machine bills per ${unit} — fix the meter type or the band before invoicing these units.`
    );
  }

  if (metered && wasCapped(b)) {
    reasons.push(
      `Units hit the monthly ceiling and were capped to ${b.actualUnits.toFixed(0)} ${unit} — the fuel issued implies more work than a month can hold, so check for a mis-keyed litre or a mis-attributed issue.`
    );
  }

  const chargesFuel = b.rateBasis === "fw" || b.rateBasis === "w";
  if (chargesFuel && b.fuelLitres > 0 && b.fuelCostCents <= 0) {
    reasons.push(`Fuel was issued (${b.fuelLitres.toFixed(0)} L) but priced at Rs 0 — set the fuel price so the fuel line isn't zero.`);
  }

  return reasons;
}
