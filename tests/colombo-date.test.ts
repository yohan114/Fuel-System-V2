import { describe, expect, it } from "vitest";
import {
  colomboDateString,
  colomboDayEnd,
  colomboDayEndExclusive,
  colomboDayStart,
  colomboMonthKey,
} from "../src/lib/colombo-date";
import { currentMonthPeriod, resolvePeriod } from "../src/lib/billing/period";

// Production storage convention: a business date of 2026-07-08 is persisted as
// 2026-07-07T18:30:00.000Z. Every fuel issue in the live database sits at
// 18:30Z for exactly this reason.
const STORED_JUL_8 = new Date("2026-07-07T18:30:00.000Z");

describe("colomboDateString", () => {
  it("reads the Colombo day, not the UTC day, for a stored day-start value", () => {
    expect(colomboDateString(STORED_JUL_8)).toBe("2026-07-08");
    // The bug this replaces:
    expect(STORED_JUL_8.toISOString().split("T")[0]).toBe("2026-07-07");
  });

  it("still reports the Colombo day for an instant late in the UTC day", () => {
    expect(colomboDateString(new Date("2026-07-07T23:45:00.000Z"))).toBe("2026-07-08");
  });

  it("reports the previous Colombo day for an instant before 18:30Z", () => {
    expect(colomboDateString(new Date("2026-07-07T18:29:59.999Z"))).toBe("2026-07-07");
  });
});

describe("colomboDayStart / colomboDayEnd", () => {
  it("brackets exactly one Colombo day", () => {
    expect(colomboDayStart("2026-07-08").toISOString()).toBe("2026-07-07T18:30:00.000Z");
    expect(colomboDayEnd("2026-07-08").toISOString()).toBe("2026-07-08T18:29:59.999Z");
    expect(colomboDayEndExclusive("2026-07-08").toISOString()).toBe("2026-07-08T18:30:00.000Z");
  });

  it("includes a value stored at that day's start", () => {
    const from = colomboDayStart("2026-07-08");
    const to = colomboDayEnd("2026-07-08");
    expect(STORED_JUL_8 >= from && STORED_JUL_8 <= to).toBe(true);
  });

  it("excludes the neighbouring days", () => {
    const from = colomboDayStart("2026-07-08");
    const to = colomboDayEnd("2026-07-08");
    const jul7 = new Date("2026-07-06T18:30:00.000Z");
    const jul9 = new Date("2026-07-08T18:30:00.000Z");
    expect(jul7 >= from).toBe(false);
    expect(jul9 <= to).toBe(false);
  });

  it("rolls over month and year boundaries", () => {
    expect(colomboDayEndExclusive("2026-06-30").toISOString()).toBe("2026-06-30T18:30:00.000Z");
    expect(colomboDayEndExclusive("2026-12-31").toISOString()).toBe("2026-12-31T18:30:00.000Z");
    expect(colomboDayStart("2027-01-01").toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("handles a leap day", () => {
    expect(colomboDayEndExclusive("2028-02-29").toISOString()).toBe("2028-02-29T18:30:00.000Z");
  });
});

describe("colomboMonthKey", () => {
  // siteOverview bucketed by UTC month, which pushed the 1st of every month
  // into the previous month: 254 rows / Rs. 3,188,490 in the live data.
  it("puts the 1st of the month in the right month", () => {
    const businessJul1 = new Date("2026-06-30T18:30:00.000Z");
    expect(colomboMonthKey(businessJul1)).toBe("2026-07");
    expect(businessJul1.toISOString().slice(0, 7)).toBe("2026-06"); // the old behaviour
  });

  it("puts the last day of the month in the right month", () => {
    expect(colomboMonthKey(new Date("2026-07-30T18:30:00.000Z"))).toBe("2026-07");
  });

  it("matches BillingPeriod.periodKey for the period bounds", () => {
    const period = resolvePeriod(2026, 7);
    expect(colomboMonthKey(period.start)).toBe(period.periodKey);
    expect(colomboMonthKey(period.end)).toBe(period.periodKey);
  });

  it("rolls the year over correctly", () => {
    expect(colomboMonthKey(new Date("2026-12-31T18:30:00.000Z"))).toBe("2027-01");
  });
});

describe("round-tripping a billing period through date strings", () => {
  // This is the regression the analytics / consumption / integrity pages hit:
  // they took a correct BillingPeriod, stringified it with toISOString(), and
  // re-parsed it — losing a day at each end.
  it("survives the string round trip and reproduces the original bounds", () => {
    const period = resolvePeriod(2026, 6);

    const fromStr = colomboDateString(period.start);
    const toStr = colomboDateString(period.end);
    expect(fromStr).toBe("2026-06-01");
    expect(toStr).toBe("2026-06-30");

    expect(colomboDayStart(fromStr).getTime()).toBe(period.start.getTime());
    expect(colomboDayEnd(toStr).getTime()).toBe(period.end.getTime());
  });

  it("demonstrates the old toISOString round trip dropped a day at both ends", () => {
    const period = resolvePeriod(2026, 6);
    expect(period.start.toISOString().split("T")[0]).toBe("2026-05-31");
    expect(period.end.toISOString().split("T")[0]).toBe("2026-06-30");
  });

  it("agrees with currentMonthPeriod for a mid-month instant", () => {
    const period = currentMonthPeriod(new Date("2026-06-15T10:00:00+05:30"));
    expect(colomboDateString(period.start)).toBe("2026-06-01");
    expect(colomboDateString(period.end)).toBe("2026-06-30");
  });
});
