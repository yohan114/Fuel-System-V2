import { describe, expect, it } from "vitest";
import { colomboDayKey, colomboDayEnd, colomboDayStart, colomboMonthKey } from "../src/lib/colombo-date";
import { currentMonthPeriod, resolvePeriod } from "../src/lib/billing/period";

// A date-only value in this system is the first instant of the Colombo day, so
// business date 2026-08-04 is stored 2026-08-03T18:30:00.000Z. Every imported
// fuel row sits at 18:30Z for that reason. Reading one back through UTC reports
// the day before — and for the 1st of a month, the month before.
//
// These run under whatever timezone the host has, which is the point.

describe("colomboMonthKey", () => {
  it("keeps the 1st of the month in its own month", () => {
    const businessAug1 = new Date("2026-07-31T18:30:00.000Z");
    expect(colomboMonthKey(businessAug1)).toBe("2026-08");
    // What bucketing by the UTC month did instead:
    expect(businessAug1.toISOString().slice(0, 7)).toBe("2026-07");
  });

  it("keeps the last day of the month in its own month", () => {
    expect(colomboMonthKey(new Date("2026-08-30T18:30:00.000Z"))).toBe("2026-08");
  });

  it("rolls the year over", () => {
    expect(colomboMonthKey(new Date("2026-12-31T18:30:00.000Z"))).toBe("2027-01");
  });

  it("agrees with BillingPeriod.periodKey at both period bounds", () => {
    for (const [y, m] of [[2026, 1], [2026, 8], [2026, 12]] as const) {
      const p = resolvePeriod(y, m);
      expect(colomboMonthKey(p.start)).toBe(p.periodKey);
      expect(colomboMonthKey(p.end)).toBe(p.periodKey);
    }
  });
});

describe("colomboDayStart / colomboDayEnd", () => {
  it("brackets exactly one Colombo day", () => {
    expect(colomboDayStart("2026-08-04").toISOString()).toBe("2026-08-03T18:30:00.000Z");
    expect(colomboDayEnd("2026-08-04").toISOString()).toBe("2026-08-04T18:29:59.999Z");
  });

  it("includes a row stored at that day's first instant", () => {
    const stored = new Date("2026-08-03T18:30:00.000Z"); // business 4 August
    expect(stored >= colomboDayStart("2026-08-04")).toBe(true);
    expect(stored <= colomboDayEnd("2026-08-04")).toBe(true);
  });

  it("excludes the neighbouring days", () => {
    const from = colomboDayStart("2026-08-04");
    const to = colomboDayEnd("2026-08-04");
    expect(new Date("2026-08-02T18:30:00.000Z") >= from).toBe(false); // business 3rd
    expect(new Date("2026-08-04T18:30:00.000Z") <= to).toBe(false); // business 5th
  });

  it("leaves no gap between one day's end and the next day's start", () => {
    const end = colomboDayEnd("2026-08-04");
    const nextStart = colomboDayStart("2026-08-05");
    expect(nextStart.getTime() - end.getTime()).toBe(1);
  });

  it("spans a whole month without dropping either end", () => {
    // The regression on /reports: picking 2026-06-01..2026-06-30 used to drop all
    // of business 1 June and pull in business 1 July.
    const from = colomboDayStart("2026-06-01");
    const to = colomboDayEnd("2026-06-30");
    const jun1 = new Date("2026-05-31T18:30:00.000Z");
    const jun30 = new Date("2026-06-29T18:30:00.000Z");
    const jul1 = new Date("2026-06-30T18:30:00.000Z");
    expect(jun1 >= from && jun1 <= to).toBe(true);
    expect(jun30 >= from && jun30 <= to).toBe(true);
    expect(jul1 <= to).toBe(false);
  });

  it("matches the period a BillingPeriod describes, via day keys", () => {
    const p = resolvePeriod(2026, 6);
    expect(colomboDayStart(colomboDayKey(p.start)).getTime()).toBe(p.start.getTime());
    expect(colomboDayEnd(colomboDayKey(p.end)).getTime()).toBe(p.end.getTime());
  });

  it("handles a leap day and a year boundary", () => {
    expect(colomboDayEnd("2028-02-29").toISOString()).toBe("2028-02-29T18:29:59.999Z");
    expect(colomboDayStart("2027-01-01").toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("month defaults derived from a period", () => {
  it("yields the first and last Colombo day of the current month", () => {
    const p = currentMonthPeriod(new Date("2026-06-15T10:00:00+05:30"));
    expect(colomboDayKey(p.start)).toBe("2026-06-01");
    expect(colomboDayKey(p.end)).toBe("2026-06-30");
    // The old toISOString() default was a day early at the start:
    expect(p.start.toISOString().split("T")[0]).toBe("2026-05-31");
  });
});
