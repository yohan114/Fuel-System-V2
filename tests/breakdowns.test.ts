import { describe, expect, it } from "vitest";
import { coalesceEpisodes, type ConditionDayRow } from "../src/lib/breakdowns";

const B = (day: string, note: string | null = null): ConditionDayRow => ({ day, status: "BREAKDOWN", note });
const W = (day: string): ConditionDayRow => ({ day, status: "WORKING", note: null });

describe("coalesceEpisodes", () => {
  it("merges consecutive breakdown days into one open episode", () => {
    const eps = coalesceEpisodes([B("2026-03-01"), B("2026-03-02"), B("2026-03-03")]);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ startDay: "2026-03-01", endDay: "2026-03-03", days: 3, open: true });
  });

  it("closes an episode when a working day follows", () => {
    const eps = coalesceEpisodes([B("2026-03-01"), B("2026-03-02"), W("2026-03-03")]);
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ days: 2, open: false });
  });

  it("treats a logging gap as a repair (two episodes)", () => {
    const eps = coalesceEpisodes([B("2026-03-01"), B("2026-03-05")]);
    expect(eps).toHaveLength(2);
    expect(eps[0]).toMatchObject({ startDay: "2026-03-01", endDay: "2026-03-01", open: false });
    expect(eps[1]).toMatchObject({ startDay: "2026-03-05", endDay: "2026-03-05", open: true });
  });

  it("spans month boundaries by calendar day", () => {
    const eps = coalesceEpisodes([B("2026-02-28"), B("2026-03-01")]);
    expect(eps).toHaveLength(1);
    expect(eps[0].days).toBe(2);
  });

  it("keeps the most recent note of a run", () => {
    const eps = coalesceEpisodes([B("2026-03-01", "first"), B("2026-03-02", "latest")]);
    expect(eps[0].lastNote).toBe("latest");
  });

  it("returns nothing for working-only or empty logs", () => {
    expect(coalesceEpisodes([W("2026-03-01")])).toHaveLength(0);
    expect(coalesceEpisodes([])).toHaveLength(0);
  });

  it("only the final run can be open", () => {
    const eps = coalesceEpisodes([B("2026-03-01"), W("2026-03-02"), B("2026-03-04", "x")]);
    expect(eps).toHaveLength(2);
    expect(eps[0].open).toBe(false);
    expect(eps[1].open).toBe(true);
  });
});
