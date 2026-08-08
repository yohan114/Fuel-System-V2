// Pure billing math — no DB access, fully unit-testable. Replicates the
// E&C Machine Rental Calculator exactly: billable = max(actual, minimum);
// fuel is charged on the driver-supplied bases (Fully Wet / Wet); SSCL applies
// to the subtotal and VAT applies to (subtotal + SSCL). All money is LKR cents.

export type BillingMode = "hourly" | "perkm" | "perday";
export type RateBasis = "fw" | "w" | "d";

export interface LineComputation {
  billingMode: BillingMode;
  rateBasis: RateBasis;
  rateCents: number;
  actualUnits: number;
  minimumUnits: number;
  fuelLitres: number;
  fuelCostCents: number;
  ssclRate: number;
  vatRate: number;
  // Fuel-only bill: a privately-owned vehicle E&C fuels but does not rent. No
  // rental is charged (regardless of rate/minimum) and the issued fuel is always
  // billed, so the subtotal is the fuel alone.
  fuelOnly?: boolean;
}

export interface ComputedTotals {
  billableUnits: number;
  rentalAmountCents: number;
  fuelChargedCents: number; // fuelCostCents when basis is 'fw' or 'w', else 0
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
}

export function computeTotals(i: LineComputation): ComputedTotals {
  const billableUnits = Math.max(i.actualUnits, i.minimumUnits);
  // A fuel-only vehicle is not rented, so no rental is charged whatever the
  // rate/minimum would otherwise say.
  const rentalAmountCents = i.fuelOnly ? 0 : Math.round(billableUnits * i.rateCents);

  // E&C supplies the fuel whenever a driver is provided (Fully Wet or Wet), so
  // the vehicle's monthly fuel total — issued at any site/pump — is billed on
  // top of the rental. On the Dry basis the customer self-fuels, so it is not.
  // A fuel-only vehicle is always billed its issued fuel (that is the point).
  const fuelChargedCents = i.fuelOnly || i.rateBasis === "fw" || i.rateBasis === "w" ? i.fuelCostCents : 0;

  const subtotalCents = rentalAmountCents + fuelChargedCents;
  const ssclCents = Math.round(subtotalCents * i.ssclRate);
  const preVatCents = subtotalCents + ssclCents;
  const vatCents = Math.round(preVatCents * i.vatRate);
  const grandTotalCents = preVatCents + vatCents;

  return {
    billableUnits,
    rentalAmountCents,
    fuelChargedCents,
    subtotalCents,
    ssclCents,
    vatCents,
    grandTotalCents,
  };
}

// Display helpers (LKR).
export function centsToLkr(cents: number): number {
  return cents / 100;
}

export function unitLabel(mode: BillingMode): "hr" | "km" | "day" {
  return mode === "perkm" ? "km" : mode === "perday" ? "day" : "hr";
}

export function basisLabel(basis: RateBasis): string {
  return basis === "fw" ? "Fully Wet" : basis === "w" ? "Wet" : "Dry";
}

export function modeLabel(mode: BillingMode): string {
  return mode === "perkm" ? "Per-KM" : mode === "perday" ? "Per-Day" : "Hourly";
}
