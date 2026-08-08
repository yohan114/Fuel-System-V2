import { describe, it, expect } from "vitest";
import { resolvePeriod, previousMonthPeriod, currentMonthPeriod } from "../src/lib/billing/period";

// The billing month decides which fuel, which meter movement and which assigned
// days belong to a bill. Fuel is stored at Colombo midnight — 18:30Z the day
// before — so a period built from the server's own date parts slides the whole
// month by a day on a UTC host: the 1st falls before the start and is billed to
// nobody, and the 1st of the NEXT month falls inside the end and is billed to
// the month just closed.
//
// These run under whatever timezone the host has, which is the point.

const colomboMidnight = (s: string) => new Date(`${s}T00:00:00+05:30`);
const inside = (d: Date, p: { start: Date; end: Date }) => d >= p.start && d <= p.end;

describe("billing periods are Colombo months on any host", () => {
  it("starts at Colombo midnight on the 1st", () => {
    expect(resolvePeriod(2026, 5).start.toISOString()).toBe("2026-04-30T18:30:00.000Z");
  });

  it("ends one millisecond before the next month begins", () => {
    const may = resolvePeriod(2026, 5);
    const jun = resolvePeriod(2026, 6);
    expect(jun.start.getTime() - may.end.getTime()).toBe(1);
  });

  it("includes the first day of its own month", () => {
    expect(inside(colomboMidnight("2026-05-01"), resolvePeriod(2026, 5))).toBe(true);
  });

  it("excludes the first day of the next month", () => {
    expect(inside(colomboMidnight("2026-06-01"), resolvePeriod(2026, 5))).toBe(false);
  });

  it("includes the last day of its own month", () => {
    expect(inside(colomboMidnight("2026-05-31"), resolvePeriod(2026, 5))).toBe(true);
  });

  it("rolls the year over in December", () => {
    const dec = resolvePeriod(2026, 12);
    expect(inside(colomboMidnight("2026-12-31"), dec)).toBe(true);
    expect(inside(colomboMidnight("2027-01-01"), dec)).toBe(false);
  });

  it("covers February without gap or overlap against March", () => {
    const feb = resolvePeriod(2026, 2);
    expect(inside(colomboMidnight("2026-02-28"), feb)).toBe(true);
    expect(inside(colomboMidnight("2026-03-01"), feb)).toBe(false);
    expect(resolvePeriod(2026, 3).start.getTime() - feb.end.getTime()).toBe(1);
  });

  it("leaves no day unbilled between consecutive months", () => {
    for (let m = 1; m <= 11; m++) {
      expect(resolvePeriod(2026, m + 1).start.getTime() - resolvePeriod(2026, m).end.getTime()).toBe(1);
    }
  });

  it("resolves the previous and current Colombo month from an instant", () => {
    // 1 June 02:00 Colombo is still 31 May in UTC — the month must come from
    // the Colombo calendar, not the host's.
    const justAfterMidnightColombo = new Date("2026-06-01T02:00:00+05:30");
    expect(currentMonthPeriod(justAfterMidnightColombo).periodKey).toBe("2026-06");
    expect(previousMonthPeriod(justAfterMidnightColombo).periodKey).toBe("2026-05");
  });
});
