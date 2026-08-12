// Colombo calendar-date helpers.
//
// Why this exists: date-only values in this system (FuelIssue.issueDate,
// MeterReading.readingDate, DailyCondition.logDate, billing period bounds) are
// stored as the FIRST INSTANT OF THE COLOMBO DAY. A business date of
// 2026-07-08 is persisted as 2026-07-07T18:30:00.000Z, because Sri Lanka is
// UTC+05:30.
//
// That makes `someDate.toISOString().split("T")[0]` WRONG for these values — it
// yields the previous calendar day. Equally, `new Date("2026-07-08T00:00:00")`
// depends on the server's timezone and `...T00:00:00Z` is UTC midnight, which
// is 05:30 into the Colombo day. Use these helpers instead of hand-rolling any
// of those.
//
// Sri Lanka has observed a fixed UTC+05:30 with no DST since 2006, so a
// constant offset is safe here and keeps the functions independent of whatever
// timezone the server happens to run in.

export const COLOMBO_TZ = "Asia/Colombo";

const COLOMBO_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The Colombo calendar date ("YYYY-MM-DD") on which the instant `d` falls. */
export function colomboDateString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: COLOMBO_TZ });
}

/** Today's Colombo calendar date ("YYYY-MM-DD"). */
export function colomboToday(now: Date = new Date()): string {
  return colomboDateString(now);
}

/**
 * The Colombo calendar month ("YYYY-MM") that the instant `d` falls in.
 * Matches BillingPeriod.periodKey, so the two can be compared directly.
 */
export function colomboMonthKey(d: Date): string {
  return colomboDateString(d).slice(0, 7);
}

function parts(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Invalid Colombo date string: "${dateStr}"`);
  return [y, m, d];
}

/**
 * First instant of the Colombo calendar day `dateStr`.
 * Use as an inclusive lower bound (`gte`).
 */
export function colomboDayStart(dateStr: string): Date {
  const [y, m, d] = parts(dateStr);
  return new Date(Date.UTC(y, m - 1, d) - COLOMBO_OFFSET_MS);
}

/**
 * Last instant of the Colombo calendar day `dateStr` (…T23:59:59.999 local).
 * Use as an inclusive upper bound (`lte`).
 */
export function colomboDayEnd(dateStr: string): Date {
  const [y, m, d] = parts(dateStr);
  // Date.UTC normalises day overflow, so d + 1 rolls the month/year correctly.
  return new Date(Date.UTC(y, m - 1, d + 1) - COLOMBO_OFFSET_MS - 1);
}

/**
 * First instant AFTER the Colombo calendar day `dateStr`.
 * Use as an exclusive upper bound (`lt`), which is preferable to `colomboDayEnd`
 * when the column can carry a real time-of-day component.
 */
export function colomboDayEndExclusive(dateStr: string): Date {
  const [y, m, d] = parts(dateStr);
  return new Date(Date.UTC(y, m - 1, d + 1) - COLOMBO_OFFSET_MS);
}
