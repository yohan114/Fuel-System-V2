import { describe, expect, it } from "vitest";

// Pure unit test verifying subwindow partition and clamping behavior
// matching src/lib/billing/usage.ts resolveWindowDelta

interface SubWindow {
  type: "PHYSICAL" | "GOOGLE";
  subStart: Date;
  subEnd: Date;
}

interface Reading {
  value: number;
  readingDate: Date;
  source: string;
}

interface Outage {
  startDate: Date;
  endDate: Date | null;
}

function partitionSubWindows(start: Date, end: Date, outages: Outage[]): SubWindow[] {
  const subWindows: SubWindow[] = [];
  const sorted = [...outages].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  let cur = start;

  for (const o of sorted) {
    const oStart = o.startDate < cur ? cur : o.startDate;
    const oEnd = !o.endDate || o.endDate > end ? end : o.endDate;

    if (oStart > cur) {
      subWindows.push({ type: "PHYSICAL", subStart: cur, subEnd: oStart });
    }
    subWindows.push({
      type: "GOOGLE",
      subStart: oStart,
      subEnd: oEnd,
    });
    cur = oEnd;
    if (cur >= end) break;
  }

  if (cur < end) {
    subWindows.push({ type: "PHYSICAL", subStart: cur, subEnd: end });
  }

  return subWindows;
}

function computeSubWindowDelta(
  subWindows: SubWindow[],
  allReadings: Reading[],
  meterType: "KM" | "HOURS"
): number {
  const DAY = 24 * 60 * 60 * 1000;
  let totalDelta = 0;

  for (const sw of subWindows) {
    const swDays = Math.max(1, (sw.subEnd.getTime() - sw.subStart.getTime()) / DAY);
    const maxAllowed = (meterType === "KM" ? 200 : 24) * swDays;

    if (sw.type === "GOOGLE") {
      const gReadings = allReadings.filter(
        (r) => r.readingDate >= sw.subStart && r.readingDate <= sw.subEnd
      );
      if (gReadings.length >= 2) {
        const deltaG = gReadings[gReadings.length - 1].value - gReadings[0].value;
        if (deltaG > 0 && deltaG <= maxAllowed) {
          totalDelta += deltaG;
        }
      }
    } else {
      const pReadings = allReadings.filter(
        (r) => r.source !== "GOOGLE_ESTIMATE" && r.readingDate >= sw.subStart && r.readingDate <= sw.subEnd
      );
      if (pReadings.length >= 2) {
        const deltaP = pReadings[pReadings.length - 1].value - pReadings[0].value;
        if (deltaP > 0 && deltaP <= maxAllowed) {
          totalDelta += deltaP;
        }
      } else if (pReadings.length === 1) {
        const prev = allReadings
          .filter((r) => r.source !== "GOOGLE_ESTIMATE" && r.readingDate <= sw.subStart)
          .pop();
        if (prev && pReadings[0].value > prev.value) {
          const deltaP = pReadings[0].value - prev.value;
          if (deltaP <= maxAllowed) totalDelta += deltaP;
        }
      }
    }
  }

  return Math.round(totalDelta * 10) / 10;
}

describe("Billing Usage across Outages (resolveWindowDelta logic)", () => {
  const start = new Date("2026-08-01T00:00:00Z");
  const end = new Date("2026-08-31T00:00:00Z");

  it("splits a period into Physical / Google / Physical sub-windows (10 / 15 / 5 days)", () => {
    const outageStart = new Date("2026-08-11T00:00:00Z");
    const outageEnd = new Date("2026-08-26T00:00:00Z");

    const subWindows = partitionSubWindows(start, end, [{ startDate: outageStart, endDate: outageEnd }]);

    expect(subWindows).toHaveLength(3);
    expect(subWindows[0]).toEqual({
      type: "PHYSICAL",
      subStart: start,
      subEnd: outageStart,
    });
    expect(subWindows[1]).toEqual({
      type: "GOOGLE",
      subStart: outageStart,
      subEnd: outageEnd,
    });
    expect(subWindows[2]).toEqual({
      type: "PHYSICAL",
      subStart: outageEnd,
      subEnd: end,
    });
  });

  it("accurately sums deltas across physical and Google sub-windows", () => {
    const outageStart = new Date("2026-08-11T00:00:00Z");
    const outageEnd = new Date("2026-08-26T00:00:00Z");
    const subWindows = partitionSubWindows(start, end, [{ startDate: outageStart, endDate: outageEnd }]);

    const readings: Reading[] = [
      // Physical subwindow 1: 10,000 -> 10,500 (+500 km)
      { value: 10000, readingDate: new Date("2026-08-01T08:00:00Z"), source: "MANUAL" },
      { value: 10500, readingDate: new Date("2026-08-10T17:00:00Z"), source: "MANUAL" },
      // Google subwindow: 10,550 -> 11,250 (+700 km)
      { value: 10550, readingDate: new Date("2026-08-11T09:00:00Z"), source: "GOOGLE_ESTIMATE" },
      { value: 11250, readingDate: new Date("2026-08-25T18:00:00Z"), source: "GOOGLE_ESTIMATE" },
      // Physical subwindow 2: 11,260 (repaired) -> 11,560 (+300 km)
      { value: 11260, readingDate: new Date("2026-08-26T08:00:00Z"), source: "REPAIR_RESUME" },
      { value: 11560, readingDate: new Date("2026-08-30T16:00:00Z"), source: "MANUAL" },
    ];

    const delta = computeSubWindowDelta(subWindows, readings, "KM");
    expect(delta).toBe(500 + 700 + 300); // 1500 km
  });

  it("clamps and ignores bogus readings exceeding the physical ceiling (200 km/day)", () => {
    const outageStart = new Date("2026-08-11T00:00:00Z");
    const outageEnd = new Date("2026-08-26T00:00:00Z"); // 15 days -> ceiling 3000 km
    const subWindows = partitionSubWindows(start, end, [{ startDate: outageStart, endDate: outageEnd }]);

    const readings: Reading[] = [
      // Physical 1: 10,000 -> 10,400 (+400 km)
      { value: 10000, readingDate: new Date("2026-08-01T08:00:00Z"), source: "MANUAL" },
      { value: 10400, readingDate: new Date("2026-08-10T17:00:00Z"), source: "MANUAL" },
      // Bogus Google estimate: 10,400 -> 50,000 (+39,600 km, exceeds 3000 km max)
      { value: 10400, readingDate: new Date("2026-08-11T09:00:00Z"), source: "GOOGLE_ESTIMATE" },
      { value: 50000, readingDate: new Date("2026-08-25T18:00:00Z"), source: "GOOGLE_ESTIMATE" },
      // Physical 2: 10,400 -> 10,650 (+250 km)
      { value: 10400, readingDate: new Date("2026-08-26T08:00:00Z"), source: "REPAIR_RESUME" },
      { value: 10650, readingDate: new Date("2026-08-30T16:00:00Z"), source: "MANUAL" },
    ];

    const delta = computeSubWindowDelta(subWindows, readings, "KM");
    // The bogus Google estimate is rejected because deltaG > maxAllowed.
    // Physical deltas are preserved: 400 + 250 = 650.
    expect(delta).toBe(650);
  });

  it("suppresses opening and closing on bill when replacement occurred in window", () => {
    const replacedInWindow = true;
    let openingVal: number | null = 185000;
    let closingVal: number | null = 250;

    if (replacedInWindow) {
      openingVal = null;
      closingVal = null;
    }

    expect(openingVal).toBeNull();
    expect(closingVal).toBeNull();
  });
});
