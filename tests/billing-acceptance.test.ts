// The owner's billing acceptance test (spec section L), encoded so it cannot
// silently regress.
//
//   VEH-001, monthly minimum 300,000.
//   January: allocated to Site A from 01 Jan; transfers to Site B effective 25 Jan.
//   Fuel at Site A on 05, 12, 20 Jan. Fuel at Site B on 26, 30 Jan.
//   Expected: Site A billed 01-24 (24 days), Site B billed 25-31 (7 days),
//   Site A gets only the 05/12/20 issues, Site B only 26/30, total days = 31,
//   no duplicate fuel cost and no duplicate vehicle charge.
//
// The day arithmetic is resolveDayRuns(); the fuel split follows from it, because
// the runs partition the month into non-overlapping windows and each fuel issue
// is summed into the one window whose dates contain it.

import { describe, expect, it } from "vitest";
import { resolveDayRuns, type AssignmentSpan } from "../src/lib/assignments";

// Day numbers are whole days since the epoch in Colombo terms; the resolver only
// needs them to be consecutive integers, so a January-2026 offset is used here.
const JAN = (day: number) => 20_454 + day; // arbitrary stable base for 2026-01-01 = day 1
const MONTH_START = JAN(1);
const MONTH_END = JAN(31);

function span(projectCode: string, fromDay: number, toDay: number | null, startMs: number): AssignmentSpan {
  return {
    projectId: `p-${projectCode}`,
    projectCode,
    projectName: projectCode,
    startDay: JAN(fromDay),
    endDay: toDay == null ? Number.MAX_SAFE_INTEGER : JAN(toDay),
    startMs,
    createdMs: startMs,
    billingType: null,
    driverName: null,
  };
}

describe("spec L — vehicle transfers between sites mid-month", () => {
  // Site A from 01 Jan (open-ended), Site B from 25 Jan. The transfer is expressed
  // the way the system records it: a new posting starting on the transfer date.
  const spans = [span("SITE-A", 1, null, 1_000), span("SITE-B", 25, null, 2_000)];
  const runs = resolveDayRuns(spans, MONTH_START, MONTH_END);

  it("produces exactly two billing segments", () => {
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.projectCode)).toEqual(["SITE-A", "SITE-B"]);
  });

  it("bills Site A for 01-24 January — 24 days, ending the day BEFORE the transfer", () => {
    expect(runs[0].startDay).toBe(JAN(1));
    expect(runs[0].endDay).toBe(JAN(24));
    expect(runs[0].days).toBe(24);
  });

  it("bills Site B from the transfer date itself — 25-31 January, 7 days", () => {
    expect(runs[1].startDay).toBe(JAN(25));
    expect(runs[1].endDay).toBe(JAN(31));
    expect(runs[1].days).toBe(7);
  });

  it("totals exactly the days in the month — never more, never fewer", () => {
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(31);
  });

  it("assigns each fuel issue date to exactly one site", () => {
    // The five issues from the acceptance test.
    const issues = [5, 12, 20, 26, 30];
    const siteOf = (day: number) => {
      const hit = runs.filter((r) => r.startDay <= JAN(day) && r.endDay >= JAN(day));
      expect(hit, `day ${day} must belong to exactly one site`).toHaveLength(1);
      return hit[0].projectCode;
    };
    expect(issues.map(siteOf)).toEqual(["SITE-A", "SITE-A", "SITE-A", "SITE-B", "SITE-B"]);
  });

  it("puts a fuel issue ON the transfer date at the NEW site", () => {
    // The boundary case: 25 January belongs to Site B, not Site A.
    const hit = runs.filter((r) => r.startDay <= JAN(25) && r.endDay >= JAN(25));
    expect(hit).toHaveLength(1);
    expect(hit[0].projectCode).toBe("SITE-B");
  });
});

describe("spec E — several transfers in one month", () => {
  // Site A 01-10, Site B 11-20, Site C 21-31.
  const runs = resolveDayRuns(
    [span("A", 1, null, 1_000), span("B", 11, null, 2_000), span("C", 21, null, 3_000)],
    MONTH_START,
    MONTH_END
  );

  it("produces one segment per site period", () => {
    expect(runs.map((r) => [r.projectCode, r.days])).toEqual([["A", 10], ["B", 10], ["C", 11]]);
  });

  it("still totals the days in the month", () => {
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(31);
  });
});

describe("spec D — a vehicle arriving at a new site mid-month", () => {
  it("bills only from the arrival date to month end", () => {
    // Arrives 11 January: 21 billable days including the 11th.
    const runs = resolveDayRuns([span("NEW-SITE", 11, null, 1_000)], MONTH_START, MONTH_END);
    expect(runs).toHaveLength(1);
    expect(runs[0].days).toBe(21);
    // The owner's worked example: 300,000 / 31 x 21.
    const prorated = (300_000 / 31) * runs[0].days;
    expect(Math.round(prorated)).toBe(203_226);
  });

  it("bills the whole month once the vehicle is there for all of it", () => {
    const runs = resolveDayRuns([span("NEW-SITE", 1, null, 1_000)], MONTH_START, MONTH_END);
    expect(runs[0].days).toBe(31);
  });

  it("stops at the day the vehicle leaves", () => {
    const runs = resolveDayRuns([span("SITE-A", 1, 15, 1_000)], MONTH_START, MONTH_END);
    expect(runs[0].days).toBe(15);
  });
});

describe("spec I — a vehicle can never be billed twice for one day", () => {
  it("awards a contested day to a single site when postings overlap", () => {
    // Two postings genuinely overlapping 10-20 January — a data error that exists
    // in the live register. The later-starting posting wins the contested days.
    const runs = resolveDayRuns(
      [span("A", 1, 20, 1_000), span("B", 10, null, 2_000)],
      MONTH_START,
      MONTH_END
    );
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(31);
    expect(runs.map((r) => [r.projectCode, r.days])).toEqual([["A", 9], ["B", 22]]);
  });

  it("never exceeds the month even with many overlapping postings", () => {
    const runs = resolveDayRuns(
      [span("A", 1, null, 1), span("B", 1, null, 2), span("C", 1, null, 3), span("D", 5, 9, 4)],
      MONTH_START,
      MONTH_END
    );
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(31);
  });

  it("leaves unposted days unbilled rather than guessing", () => {
    // A gap between postings is a gap in billing — the vehicle was nowhere.
    const runs = resolveDayRuns(
      [span("A", 1, 10, 1_000), span("B", 20, null, 2_000)],
      MONTH_START,
      MONTH_END
    );
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(22); // 10 + 12, days 11-19 unbilled
  });
});

describe("February and month boundaries", () => {
  it("counts a 28-day month correctly", () => {
    const FEB_START = JAN(32);
    const FEB_END = JAN(59); // 28 days
    const runs = resolveDayRuns(
      [{ ...span("A", 32, null, 1_000) }, { ...span("B", 46, null, 2_000) }],
      FEB_START,
      FEB_END
    );
    expect(runs.reduce((n, r) => n + r.days, 0)).toBe(28);
    expect(runs.map((r) => r.days)).toEqual([14, 14]);
  });
});
