import { describe, it, expect } from "vitest";
import { dayNumber, startOfColomboDay, endOfColomboDay } from "../src/lib/assignments";

// A billing segment's bounds are what it uses to gather its fuel, its meter
// delta and its working days. They are rebuilt from a day index, and a day index
// counts COLOMBO days — so the rebuild has to return through the Colombo
// calendar. It used to read the server's own Y-M-D, which is the same thing only
// on a Colombo-time host; on the UTC server every boundary landed a day early
// and a vehicle that changed sites mid-month had a day's fuel and a day's meter
// movement charged to the site it had just left.
//
// These run under whatever timezone the host has, which is the point: the
// answers below are the same in Colombo, in UTC, and anywhere else.

const day = (s: string) => dayNumber(new Date(`${s}T00:00:00+05:30`));
const colomboYMD = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

describe("Colombo day bounds are the inverse of dayNumber", () => {
  it("round-trips a day index back to the same Colombo date", () => {
    for (const s of ["2026-01-01", "2026-05-11", "2026-05-31", "2026-08-06", "2026-12-31"]) {
      expect(colomboYMD(startOfColomboDay(day(s)))).toBe(s);
      expect(colomboYMD(endOfColomboDay(day(s)))).toBe(s);
    }
  });

  it("starts the day at Colombo midnight, which is 18:30Z the day before", () => {
    expect(startOfColomboDay(day("2026-05-11")).toISOString()).toBe("2026-05-10T18:30:00.000Z");
  });

  it("ends the day just before the next one begins", () => {
    const end = endOfColomboDay(day("2026-05-10"));
    const nextStart = startOfColomboDay(day("2026-05-11"));
    expect(end.getTime()).toBeLessThan(nextStart.getTime());
    expect(nextStart.getTime() - end.getTime()).toBe(1);
  });

  it("keeps a mid-month site change on the right side of the boundary", () => {
    // LB-21 left CEP-03W after 10 May and started at CEP-03F on the 11th.
    const wadakadaEnds = endOfColomboDay(day("2026-05-10"));
    const galagedaraBegins = startOfColomboDay(day("2026-05-11"));
    // Fuel drawn at Colombo midnight on the 11th — how every imported row is
    // stored — belongs to Galagedara, not to the site it just left.
    const drawnOn11th = new Date("2026-05-11T00:00:00+05:30");
    expect(drawnOn11th.getTime()).toBeGreaterThan(wadakadaEnds.getTime());
    expect(drawnOn11th.getTime()).toBeGreaterThanOrEqual(galagedaraBegins.getTime());
  });
});
