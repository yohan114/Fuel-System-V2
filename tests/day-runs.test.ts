import { describe, it, expect } from "vitest";
import { resolveDayRuns, type AssignmentSpan } from "../src/lib/assignments";

const span = (p: string, s: number, e: number, startMs = 0, createdMs = 0): AssignmentSpan => ({
  projectId: p, projectCode: p, projectName: p, startDay: s, endDay: e, startMs, createdMs, billingType: null, driverName: null,
});

describe("resolveDayRuns (non-overlapping month segmentation)", () => {
  it("sequential non-overlapping postings → one run each", () => {
    const runs = resolveDayRuns([span("A", 1, 15, 1), span("B", 16, 30, 16)], 1, 30);
    expect(runs.map((r) => [r.projectCode, r.days])).toEqual([["A", 15], ["B", 15]]);
    expect(runs.reduce((s, r) => s + r.days, 0)).toBe(30);
  });

  it("a later posting supersedes the overlap (latest start wins)", () => {
    // A covers the whole month; B (starts day 10) supersedes days 10–20.
    const runs = resolveDayRuns([span("A", 1, 30, 1), span("B", 10, 20, 10)], 1, 30);
    expect(runs.map((r) => [r.projectCode, r.startDay, r.endDay])).toEqual([
      ["A", 1, 9], ["B", 10, 20], ["A", 21, 30],
    ]);
    expect(runs.reduce((s, r) => s + r.days, 0)).toBe(30);
  });

  it("fully-overlapping full-month postings never exceed month days (createdAt breaks the tie)", () => {
    const runs = resolveDayRuns([span("A", 1, 30, 1, 100), span("B", 1, 30, 1, 200)], 1, 30);
    expect(runs).toHaveLength(1);
    expect(runs[0].projectCode).toBe("B"); // later createdAt wins
    expect(runs[0].days).toBe(30);
  });

  it("many overlaps still cap total days at the month (the BM-02 case)", () => {
    // Mirrors BM-02: four sites all overlapping a 30-day month (was 82 days).
    const spans = [span("BADAL", 1, 30, 1), span("LOT-04", 1, 30, 2), span("BATTI-02", 1, 21, 3), span("INGI", 1, 1, 4)];
    const runs = resolveDayRuns(spans, 1, 30);
    expect(runs.reduce((s, r) => s + r.days, 0)).toBe(30);
    expect(runs.reduce((s, r) => s + r.days, 0)).toBeLessThanOrEqual(30);
  });

  it("gaps between postings leave uncovered days unbilled", () => {
    const runs = resolveDayRuns([span("A", 1, 10, 1), span("B", 20, 30, 20)], 1, 30);
    expect(runs.map((r) => [r.projectCode, r.days])).toEqual([["A", 10], ["B", 11]]);
    expect(runs.reduce((s, r) => s + r.days, 0)).toBe(21);
  });

  it("no spans → no runs", () => {
    expect(resolveDayRuns([], 1, 30)).toEqual([]);
  });
});
