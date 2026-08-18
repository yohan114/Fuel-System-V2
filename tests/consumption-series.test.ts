import { describe, expect, it } from "vitest";
import { buildIntervals, type RawAnchor } from "../src/lib/analytics/consumption-series";

// Colombo midnight, the way every imported issue is stored.
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

let seq = 0;
function issue(iso: string, litres: number, meter?: number, readingType = "KM"): RawAnchor {
  seq += 1;
  return {
    id: `i${String(seq).padStart(4, "0")}`,
    issueDate: day(iso),
    litres,
    meterReading: meter ?? null,
    readingType: meter == null ? null : readingType,
    createdAt: new Date(2026, 0, 1, 0, 0, seq),
  };
}

describe("buildIntervals", () => {
  it("measures litres against meter movement between fills", () => {
    const { points } = buildIntervals(
      [issue("2026-07-01", 50, 100_000), issue("2026-07-10", 60, 100_600)],
      "KM",
      "km"
    );
    expect(points).toHaveLength(1);
    // The closing fill's litres are what moved the meter to its new value.
    expect(points[0].meterDelta).toBe(600);
    expect(points[0].litres).toBe(60);
    expect(points[0].rate).toBeCloseTo(0.1, 10); // 10 km/L
  });

  it("counts unmetered issues in the window they fall in", () => {
    const { points } = buildIntervals(
      [
        issue("2026-07-01", 50, 100_000),
        issue("2026-07-05", 40), // no reading — still burned fuel
        issue("2026-07-10", 60, 100_600),
      ],
      "KM",
      "km"
    );
    expect(points[0].litres).toBe(100);
  });

  it("drops the tiny reading gaps that would otherwise top the repair list", () => {
    // DC-24 in the live data: 30 L across a 23 km gap reads as 0.77 km/L.
    const { points, rejected } = buildIntervals(
      [issue("2026-07-01", 20, 330_212), issue("2026-07-02", 30, 330_235)],
      "KM",
      "km"
    );
    expect(points).toHaveLength(0);
    expect(rejected.tooSmall).toBe(1);
  });

  it("merges short hops instead of discarding their litres", () => {
    // Five 60 km hops: none measurable alone, together they are 300 km on 30 L
    // = 10 km/L. Discarding them would lose the fuel entirely.
    const { points } = buildIntervals(
      [
        issue("2026-07-01", 0, 200_000),
        issue("2026-07-02", 6, 200_060),
        issue("2026-07-03", 6, 200_120),
        issue("2026-07-04", 6, 200_180),
        issue("2026-07-05", 6, 200_240),
        issue("2026-07-06", 6, 200_300),
      ],
      "KM",
      "km"
    );
    // Emits as soon as the accumulated movement clears the 200 km floor — at
    // the fourth hop (240 km / 24 L) — rather than waiting for the whole run.
    expect(points).toHaveLength(1);
    expect(points[0].meterDelta).toBe(240);
    expect(points[0].litres).toBe(24);
    expect(points[0].rate).toBeCloseTo(0.1, 10); // 10 km/L
  });

  it("does not merge across a meter reset — the scale changed", () => {
    const { points, rejected } = buildIntervals(
      [
        issue("2026-07-01", 10, 200_000),
        issue("2026-07-02", 10, 200_060), // short, accumulating
        issue("2026-07-03", 10, 500), // meter replaced
        issue("2026-07-04", 10, 800),
      ],
      "KM",
      "km"
    );
    expect(rejected.nonPositive).toBe(1);
    // Nothing spans the reset; the 300 km after it is below the floor.
    expect(points).toHaveLength(0);
  });

  it("rejects a backwards meter without discarding the rest of the series", () => {
    const { points, rejected } = buildIntervals(
      [
        issue("2026-07-01", 50, 100_000),
        issue("2026-07-05", 50, 99_000), // backwards
        issue("2026-07-20", 80, 99_900),
      ],
      "KM",
      "km"
    );
    expect(rejected.nonPositive).toBe(1);
    expect(points).toHaveLength(1); // the pair after the reset still measures
  });

  it("rejects a digit-insertion typo rather than believing a 10x month", () => {
    // HCC-01: 1,735,766 where 173,576 was meant.
    const { points, rejected } = buildIntervals(
      [issue("2026-07-01", 50, 173_500), issue("2026-07-05", 60, 1_735_766)],
      "KM",
      "km"
    );
    expect(points).toHaveLength(0);
    expect(rejected.badReading).toBe(1);
  });

  it("collapses same-day fills so no litres are orphaned", () => {
    // Two metered issues on one day: without collapsing, the second interval's
    // window is (d, d] — empty — and its litres vanish from the series.
    const { points } = buildIntervals(
      [
        issue("2026-07-01", 30, 100_000),
        issue("2026-07-15", 40, 100_400),
        issue("2026-07-15", 20, 100_450),
        issue("2026-07-30", 50, 100_900),
      ],
      "KM",
      "km"
    );
    expect(points).toHaveLength(2);
    // Both 15 July fills belong to the first interval.
    expect(points[0].litres).toBe(60);
    expect(points[0].closingMeter).toBe(100_450); // the higher of the two
    expect(points[1].litres).toBe(50);
    // Nothing is lost.
    expect(points.reduce((s, p) => s + p.litres, 0)).toBe(110);
  });

  it("ignores readings taken on the wrong instrument", () => {
    // An hour value on a KM machine is on a different scale entirely.
    const { points } = buildIntervals(
      [issue("2026-07-01", 50, 100_000, "KM"), issue("2026-07-10", 60, 1_200, "HOURS")],
      "KM",
      "km"
    );
    expect(points).toHaveLength(0);
  });

  it("orders by timestamp then creation, since most issues share 18:30Z", () => {
    const a = issue("2026-07-10", 60, 100_600);
    const b = issue("2026-07-01", 50, 100_000);
    const { points } = buildIntervals([a, b], "KM", "km"); // deliberately reversed
    expect(points).toHaveLength(1);
    expect(points[0].openingMeter).toBe(100_000);
  });

  it("needs two boundaries before it reports anything", () => {
    const { points, meteredIssues } = buildIntervals([issue("2026-07-01", 50, 100_000)], "KM", "km");
    expect(points).toHaveLength(0);
    expect(meteredIssues).toBe(1);
  });

  it("works the same way on hour machines", () => {
    const { points } = buildIntervals(
      [issue("2026-07-01", 200, 4_000, "HOURS"), issue("2026-07-20", 320, 4_040, "HOURS")],
      "HOURS",
      "hr"
    );
    expect(points[0].rate).toBeCloseTo(8, 10); // 320 L / 40 h
  });
});
