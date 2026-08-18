// Deciding whether a meter reading can be believed.
//
// The legacy service system's meter column was typed by hand for three years
// and shows it: values run from a plausible 190,753 km up to 15,651,010,099 —
// digits appended to an earlier reading. Feeding those into the meter history
// would poison consumption, billing units and service scheduling all at once,
// so every service meter is checked before it is trusted.
//
// There is also a genuine ambiguity these rules cannot resolve: some machines
// carry two meters. DT-43's service records climb 173,987 → 183,258 → 190,753
// while its fuel issues read 28,605 — both sequences are internally consistent,
// they simply measure different instruments. Neither is "wrong", so those are
// reported for a human rather than silently merged.

/** No hour meter in this fleet has run 100,000 hours; no odometer 2,000,000 km. */
export const ABSOLUTE_MAX: Record<string, number> = { HOURS: 100_000, KM: 2_000_000 };

export type MeterVerdict =
  | "ok"                 // consistent with what else is known about the machine
  | "absurd"             // beyond any physical possibility
  | "scale-mismatch"     // internally sensible, but on a different scale to the fuel meters
  | "erratic"            // no reference, and the machine's own readings don't progress
  | "no-value";

export interface MeterCheck {
  verdict: MeterVerdict;
  trusted: boolean;
  reason: string;
}

export function isAbsurd(value: number, meterType: string): boolean {
  const max = ABSOLUTE_MAX[meterType] ?? ABSOLUTE_MAX.KM;
  return !Number.isFinite(value) || value <= 0 || value > max;
}

/**
 * Is `value` consistent with the range of readings already known for this
 * machine? The band is deliberately wide — half the lowest to double the
 * highest — because it only needs to catch order-of-magnitude errors, not
 * small discrepancies.
 */
export function withinReference(value: number, refMin: number, refMax: number): boolean {
  const lo = Math.min(refMin, refMax) * 0.5;
  const hi = Math.max(refMin, refMax) * 2 + 1000;
  return value >= lo && value <= hi;
}

/**
 * A sequence of readings taken over time should not go backwards, except once
 * (a meter replacement). More than one drop means the numbers are not tracking
 * a single instrument.
 */
export function isProgressing(valuesInDateOrder: number[]): boolean {
  if (valuesInDateOrder.length <= 1) return true;
  let drops = 0;
  for (let i = 1; i < valuesInDateOrder.length; i++) {
    if (valuesInDateOrder[i] < valuesInDateOrder[i - 1]) drops++;
  }
  return drops <= 1;
}

/**
 * Decide whether one service meter reading may enter the meter history.
 *
 * `reference` is the min/max of the machine's fuel-issue meter readings, or
 * null when it has none — in which case the machine's own service readings are
 * the only evidence and are judged on whether they progress.
 */
export function checkServiceMeter(opts: {
  value: number | null;
  meterType: string;
  reference: { min: number; max: number } | null;
  ownSequenceInDateOrder: number[];
}): MeterCheck {
  const { value, meterType, reference, ownSequenceInDateOrder } = opts;

  if (value == null || value <= 0) {
    return { verdict: "no-value", trusted: false, reason: "no reading was recorded" };
  }
  if (isAbsurd(value, meterType)) {
    return {
      verdict: "absurd",
      trusted: false,
      reason: `${value.toLocaleString()} exceeds any possible ${meterType === "HOURS" ? "hour meter" : "odometer"} — digits were almost certainly mis-keyed`,
    };
  }
  if (reference) {
    if (withinReference(value, reference.min, reference.max)) {
      return { verdict: "ok", trusted: true, reason: "consistent with the machine's fuel-issue meter readings" };
    }
    return {
      verdict: "scale-mismatch",
      trusted: false,
      reason: `reads ${value.toLocaleString()} but this machine's fuel issues record ${reference.min.toLocaleString()}–${reference.max.toLocaleString()} — likely a second meter`,
    };
  }
  if (isProgressing(ownSequenceInDateOrder)) {
    return { verdict: "ok", trusted: true, reason: "no fuel-issue meter to compare, but the machine's service readings progress consistently" };
  }
  return {
    verdict: "erratic",
    trusted: false,
    reason: "no fuel-issue meter to compare, and the machine's service readings jump around",
  };
}

/**
 * Can the work done since a service be measured by subtracting meters?
 * Only when both readings are on the same instrument — otherwise the
 * subtraction is meaningless and fuel is the better evidence.
 */
export function meterDeltaUsable(opts: {
  meterAtService: number | null;
  currentMeter: number | null;
  meterType: string;
}): { usable: boolean; delta: number | null; reason: string } {
  const { meterAtService, currentMeter, meterType } = opts;
  if (meterAtService == null || currentMeter == null) {
    return { usable: false, delta: null, reason: "no meter pair to subtract" };
  }
  if (isAbsurd(meterAtService, meterType) || isAbsurd(currentMeter, meterType)) {
    return { usable: false, delta: null, reason: "one of the readings is not a possible meter value" };
  }
  if (!withinReference(meterAtService, currentMeter, currentMeter)) {
    return {
      usable: false,
      delta: null,
      reason: `the service meter (${meterAtService.toLocaleString()}) and the current meter (${currentMeter.toLocaleString()}) are not the same instrument`,
    };
  }
  if (currentMeter < meterAtService) {
    return { usable: false, delta: null, reason: "the meter has gone backwards since the service — replaced or re-keyed" };
  }
  return {
    usable: true,
    delta: currentMeter - meterAtService,
    reason: `meter read ${meterAtService.toLocaleString()} at the service and ${currentMeter.toLocaleString()} at the last fuel issue`,
  };
}
