// Consumption bands: storage units, display units, and when a band may be used.
//
// STORAGE (RentalRate.fuelConsEcon/Typ/Heavy) is always "litres per unit of
// work": L/hr for hour machines, L/km for road vehicles. In storage units the
// invariant is econ < typ < heavy — higher is always worse — which is what
// classifyConsumption() relies on.
//
// DISPLAY for road vehicles is km/L, because that is how the 2026 rate workbook
// quotes them and how a driver thinks. km/L is the reciprocal of L/km, so
// inverting also reverses the ordering: in km/L, econ is the LARGEST number.
// Every human-facing surface must go through toDisplay(); every calculation
// must stay in storage units. Mixing them silently is a ~45x error, since
// L/hr values average 9.35 and L/km values average 0.208.
//
// A band may only be compared against a meter when its basis matches the
// meter. 95 machines carry an hour band while sitting on a KM odometer (the
// rate workbook and the fleet register disagree); for those, comparing gives a
// nonsense verdict, so resolveBand() reports them as not comparable rather
// than relabelling the numbers.

export type ConsBasis = "hr" | "km";

export const CONS_BASES: ConsBasis[] = ["hr", "km"];

export function consBasisForMeter(meterType: string | null | undefined): ConsBasis {
  return meterType === "KM" ? "km" : "hr";
}

// perday assets do no per-unit work, so no band applies.
export function consBasisForMode(mode: string): ConsBasis | null {
  if (mode === "perkm") return "km";
  if (mode === "hourly") return "hr";
  return null;
}

// The unit a stored value is expressed in.
export function storageUnit(basis: ConsBasis): string {
  return basis === "km" ? "L/km" : "L/hr";
}

// The unit we show people. Road vehicles flip to km/L to match the rate sheet.
export function displayUnit(basis: ConsBasis): string {
  return basis === "km" ? "km/L" : "L/hr";
}

// storage -> display. Reciprocal for km, identity for hr.
export function toDisplay(value: number | null | undefined, basis: ConsBasis): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return basis === "km" ? 1 / value : value;
}

// display -> storage. Same reciprocal; used when reading operator input and
// when importing the workbook's km/L figures.
export function fromDisplay(value: number | null | undefined, basis: ConsBasis): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return basis === "km" ? 1 / value : value;
}

export function formatCons(value: number | null | undefined, basis: ConsBasis, opts?: { withUnit?: boolean }): string {
  const d = toDisplay(value, basis);
  if (d == null) return "—";
  // km/L reads naturally at 1dp (8.0 km/L); L/km would need 4dp to say the same
  // thing, which is why we display the reciprocal.
  const n = basis === "km" ? d.toFixed(1) : d.toFixed(1);
  return opts?.withUnit === false ? n : `${n} ${displayUnit(basis)}`;
}

export type BandReason =
  | "ok"
  | "no-rate-card"
  | "no-band"
  | "basis-conflict"
  | "not-metered";

export interface ResolvedBand {
  /** Safe to compare an actual burn rate against econ/typ/heavy. */
  comparable: boolean;
  reason: BandReason;
  /** Basis of the stored band, null when there is no band. */
  basis: ConsBasis | null;
  /** Basis implied by the asset's meter. */
  meterBasis: ConsBasis;
  /** Storage units (L/hr or L/km). Null unless comparable. */
  econ: number | null;
  typ: number | null;
  heavy: number | null;
  /** Raw stored values regardless of comparability — for display on the rate card. */
  rawEcon: number | null;
  rawTyp: number | null;
  rawHeavy: number | null;
  storageUnit: string;
  displayUnit: string;
}

export interface BandSource {
  fuelConsEcon?: number | null;
  fuelConsTyp?: number | null;
  fuelConsHeavy?: number | null;
  fuelConsBasis?: string | null;
}

/**
 * Decide whether a rate card's band can be compared against this asset's meter,
 * and in which units. Never coerces a band onto a different basis — an 8 L/hr
 * figure relabelled as 8 L/km is a 45x error no downstream check could catch.
 */
export function resolveBand(
  rate: BandSource | null | undefined,
  meterType: string | null | undefined
): ResolvedBand {
  const meterBasis = consBasisForMeter(meterType);
  const base = {
    meterBasis,
    rawEcon: rate?.fuelConsEcon ?? null,
    rawTyp: rate?.fuelConsTyp ?? null,
    rawHeavy: rate?.fuelConsHeavy ?? null,
    econ: null,
    typ: null,
    heavy: null,
  };

  if (!rate) {
    return { ...base, comparable: false, reason: "no-rate-card", basis: null,
      storageUnit: storageUnit(meterBasis), displayUnit: displayUnit(meterBasis) };
  }

  // A zero or absent typ is no band at all. The workbook stores 0 for towed
  // trailers, which have no engine and therefore no consumption to check.
  const hasBand = rate.fuelConsTyp != null && rate.fuelConsTyp > 0;
  const basis = rate.fuelConsBasis === "km" || rate.fuelConsBasis === "hr" ? rate.fuelConsBasis : null;

  if (!hasBand) {
    return { ...base, comparable: false, reason: "no-band", basis,
      storageUnit: storageUnit(basis ?? meterBasis), displayUnit: displayUnit(basis ?? meterBasis) };
  }

  // An unlabelled band: infer from magnitude rather than guessing the meter.
  // The two populations separate cleanly — L/km tops out at 0.455, L/hr starts
  // at 4.0 — so a value below 1 is litres per km and above 1 is litres per hour.
  const effective = basis ?? (rate.fuelConsTyp! < 1 ? "km" : "hr");

  if (effective !== meterBasis) {
    return { ...base, comparable: false, reason: "basis-conflict", basis: effective,
      storageUnit: storageUnit(effective), displayUnit: displayUnit(effective) };
  }

  return {
    ...base,
    comparable: true,
    reason: "ok",
    basis: effective,
    econ: rate.fuelConsEcon ?? null,
    typ: rate.fuelConsTyp ?? null,
    heavy: rate.fuelConsHeavy ?? null,
    storageUnit: storageUnit(effective),
    displayUnit: displayUnit(effective),
  };
}

export const BAND_REASON_LABEL: Record<BandReason, string> = {
  ok: "band applies",
  "no-rate-card": "no rate card",
  "no-band": "no consumption band on the rate card",
  "basis-conflict": "band is per-hour but the machine is on a km meter — not comparable",
  "not-metered": "day-hire — no per-unit band",
};

// The heavy threshold is not the same severity on both bases. The rate sheet
// derives machinery Heavy = 1.35x Typ (L/hr), and road Heavy = 0.80x best
// economy in km/L, which after inversion is 1.25x Typ (L/km). So "over heavy"
// means +35% over standard for a machine and +25% for a road vehicle.
export const HEAVY_MULTIPLE: Record<ConsBasis, number> = { hr: 1.35, km: 1.25 };

// A single fill-to-fill interval is a pair of readings, not a measurement:
// partial bowser loads mean litres-in-window and distance-in-window are not the
// same physical quantity. Require enough intervals before showing a verdict.
export const MIN_INTERVALS_FOR_VERDICT = 3;

// Floors below which an interval is noise rather than consumption. A 23 km
// reading gap with a 30 L fill reads as 1.3 L/km (0.77 km/L) and would top the
// repair-candidate list on measurement error alone.
export const MIN_INTERVAL_DELTA: Record<ConsBasis, number> = { hr: 10, km: 200 };

// Physically possible burn rates, in storage units. Anything outside is a
// transcription error, not a machine.
export const PLAUSIBLE_RATE: Record<ConsBasis, { min: number; max: number }> = {
  hr: { min: 0.2, max: 60 },   // 0.2–60 L/hr
  km: { min: 0.05, max: 0.5 }, // 20 km/L down to 2 km/L
};

export function isPlausibleRate(rate: number, basis: ConsBasis): boolean {
  const p = PLAUSIBLE_RATE[basis];
  return Number.isFinite(rate) && rate >= p.min && rate <= p.max;
}
