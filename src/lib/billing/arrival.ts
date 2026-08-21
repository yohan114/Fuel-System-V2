// When a vehicle arrived at a site, and what that means for each month's bill.
//
// THE BUG THIS FIXES: presence at a site was inferred from fuel draws. A script
// wrote one AssetAssignment per contiguous run of days the vehicle happened to
// draw fuel, so a single day without a draw ended the "visit" and the next draw
// began a new one. BD-05 ended up with separate one-day postings on 2 Feb,
// 1 Jun, 4 Jun and 18 Jun — recorded as arriving and leaving on the same day,
// four times. Billing then prorated each month from that month's first draw, so
// a machine that never left the site was re-billed as a new arrival every month.
//
// THE RULE: a vehicle arrives at a site ONCE. That date is permanent. The month
// it arrives is prorated from the arrival day; every month after that is a full
// standard month, whatever the fuel pattern looks like. Fuel issues are evidence
// of consumption, never the start of a billing period.

/** Where the arrival date came from — shown on the bill so it can be judged. */
export type ArrivalSource =
  | "ALLOCATION_START" // an approved allocation said so — always preferred
  | "FIRST_FUEL_ISSUE" // no allocation existed, so the first ever draw was used
  | "MANUAL_CORRECTION"; // Finance/Admin overrode it, with a reason

export interface InitialArrival {
  date: Date;
  source: ArrivalSource;
  /** "YYYY-MM" of the arrival — the only month that may be prorated on arrival. */
  billingMonth: string;
}

/** Billing treatment for one vehicle-site in one month. */
export type BillingTreatment =
  | "FIRST_ARRIVAL_PRORATED" // the arrival month: charge from the arrival day
  | "STANDARD" // an ongoing month: charge the whole month
  | "TRANSFER_IN_PRORATED" // arrived from another site mid-month
  | "TRANSFER_OUT_PRORATED" // left for another site mid-month
  | "PART_MONTH" // both in and out inside the month
  | "NOT_AT_SITE"; // not here at all — no bill

export interface BillingWindow {
  treatment: BillingTreatment;
  /** Inclusive first and last chargeable day, or null when not at the site. */
  from: Date | null;
  to: Date | null;
  billableDays: number;
  daysInMonth: number;
  /** True only for a whole, unbroken calendar month at this site. */
  isFullMonth: boolean;
  /** Why the window is what it is, in words fit for the billing screen. */
  reason: string;
}

const DAY_MS = 86_400_000;

/** Colombo calendar day as YYYY-MM-DD — the system stores days at 18:30Z prior. */
export function colomboDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function monthKey(d: Date): string {
  return colomboDay(d).slice(0, 7);
}

/** Whole days between two Colombo days, inclusive of both ends. */
export function inclusiveDays(from: Date, to: Date): number {
  const a = Date.parse(`${colomboDay(from)}T00:00:00Z`);
  const b = Date.parse(`${colomboDay(to)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY_MS) + 1);
}

/**
 * The vehicle's ONE permanent arrival at this site.
 *
 * An approved allocation start always wins. Only when there is none does the
 * FIRST fuel issue ever recorded for this vehicle at this site stand in — and
 * "ever", not "this month", is the whole point: re-deriving it monthly is the
 * defect this module exists to prevent.
 *
 * A manual correction, once made, outranks both and is never recomputed.
 */
export function resolveInitialArrival(input: {
  /** Start dates of approved allocations of this vehicle to this site. */
  allocationStarts: Date[];
  /** Dates of every approved fuel issue for this vehicle at this site, any month. */
  fuelIssueDates: Date[];
  /** A Finance/Admin override, if one has been recorded. */
  manualOverride?: Date | null;
}): InitialArrival | null {
  if (input.manualOverride) {
    return {
      date: input.manualOverride,
      source: "MANUAL_CORRECTION",
      billingMonth: monthKey(input.manualOverride),
    };
  }
  const earliest = (dates: Date[]) =>
    dates.length ? dates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b)) : null;

  const alloc = earliest(input.allocationStarts);
  if (alloc) return { date: alloc, source: "ALLOCATION_START", billingMonth: monthKey(alloc) };

  const fuel = earliest(input.fuelIssueDates);
  if (fuel) return { date: fuel, source: "FIRST_FUEL_ISSUE", billingMonth: monthKey(fuel) };

  return null;
}

/**
 * What to charge this vehicle at this site for this month.
 *
 * The arrival date only ever shortens the FIRST month. After that the vehicle is
 * an existing active vehicle: a full month unless it actually transferred.
 */
export function resolveBillingWindow(input: {
  monthStart: Date;
  monthEnd: Date;
  arrival: InitialArrival | null;
  /** Day the vehicle moved in from another site, if it did so this month. */
  transferInDate?: Date | null;
  /** Effective transfer date away; the old site's last chargeable day is the one before. */
  transferOutDate?: Date | null;
  /** Set when the vehicle is not posted at this site in this month at all. */
  notAtSite?: boolean;
}): BillingWindow {
  const { monthStart, monthEnd } = input;
  const daysInMonth = inclusiveDays(monthStart, monthEnd);
  const mKey = monthKey(monthStart);

  const none = (reason: string): BillingWindow => ({
    treatment: "NOT_AT_SITE", from: null, to: null, billableDays: 0, daysInMonth, isFullMonth: false, reason,
  });

  if (input.notAtSite) return none("The vehicle was not posted to this site during the month.");
  if (!input.arrival) return none("No arrival date could be established for this vehicle at this site.");

  const arrivalMonth = input.arrival.billingMonth;
  // A month before the vehicle ever arrived is never billable here.
  if (mKey < arrivalMonth) {
    return none(`The vehicle did not arrive at this site until ${arrivalMonth}.`);
  }

  let from = monthStart;
  let to = monthEnd;
  let treatment: BillingTreatment = "STANDARD";
  let reason = "Existing active vehicle at this site — full standard month.";

  // The arrival month, and only the arrival month, starts on the arrival day.
  if (mKey === arrivalMonth) {
    from = input.arrival.date;
    treatment = "FIRST_ARRIVAL_PRORATED";
    reason = `First month at this site — charged from ${colomboDay(input.arrival.date)} (${
      input.arrival.source === "ALLOCATION_START" ? "allocation start" :
      input.arrival.source === "FIRST_FUEL_ISSUE" ? "first fuel issue" : "manually corrected"
    }).`;
  }

  // A transfer in overrides the month start; a transfer out ends it the day before.
  if (input.transferInDate && monthKey(input.transferInDate) === mKey) {
    if (input.transferInDate.getTime() > from.getTime()) {
      from = input.transferInDate;
      treatment = treatment === "FIRST_ARRIVAL_PRORATED" ? "FIRST_ARRIVAL_PRORATED" : "TRANSFER_IN_PRORATED";
      reason = `Transferred in on ${colomboDay(input.transferInDate)}.`;
    }
  }
  if (input.transferOutDate && monthKey(input.transferOutDate) === mKey) {
    const lastDay = new Date(input.transferOutDate.getTime() - DAY_MS);
    if (lastDay.getTime() < to.getTime()) {
      to = lastDay;
      treatment = treatment === "STANDARD" ? "TRANSFER_OUT_PRORATED" : "PART_MONTH";
      reason = `Transferred out on ${colomboDay(input.transferOutDate)} — charged to the day before.`;
    }
  }

  if (to.getTime() < from.getTime()) {
    return none("The vehicle left this site before it arrived within this month.");
  }

  const billableDays = inclusiveDays(from, to);
  return {
    treatment,
    from,
    to,
    billableDays,
    daysInMonth,
    isFullMonth: billableDays === daysInMonth,
    reason,
  };
}

/**
 * The charge for the window. A full month costs the full monthly rate; a part
 * month costs its share of the days, per the owner's formula:
 *   Monthly Rate / days in month x billable days.
 */
export function proratedCharge(monthlyRateCents: number, w: BillingWindow): number {
  if (w.billableDays <= 0 || w.daysInMonth <= 0) return 0;
  if (w.isFullMonth) return monthlyRateCents;
  return Math.round((monthlyRateCents / w.daysInMonth) * w.billableDays);
}

/**
 * The guaranteed minimum units for a full month, prorated the same way.
 * Machinery is guaranteed 120 running hours; road vehicles 3,000 running
 * kilometres. Fuel issued on only a handful of days does not reduce either —
 * the guarantee is for availability, not for the days fuel happened to be drawn.
 */
export const STANDARD_MINIMUM = { HOURS: 120, KM: 3000 } as const;

export function minimumForWindow(basis: "HOURS" | "KM", w: BillingWindow, override?: number | null): number {
  const full = override != null && override > 0 ? override : STANDARD_MINIMUM[basis];
  if (w.billableDays <= 0) return 0;
  if (w.isFullMonth) return full;
  return (full / w.daysInMonth) * w.billableDays;
}
