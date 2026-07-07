import { describe, it, expect } from "vitest";
import { colomboParts, parseRunHour, shouldSyncNow } from "../src/lib/prices/schedule-timing";

describe("price scheduler timing", () => {
  it("reads Colombo wall-clock (UTC+5:30) from an instant", () => {
    // 2026-07-06 20:00 UTC → 2026-07-07 01:30 Colombo
    const p = colomboParts(new Date("2026-07-06T20:00:00Z"));
    expect(p.day).toBe("2026-07-07");
    expect(p.hour).toBe(1);
  });

  it("crosses the day boundary correctly near midnight Colombo", () => {
    // 2026-07-06 18:30 UTC = exactly 2026-07-07 00:00 Colombo
    expect(colomboParts(new Date("2026-07-06T18:30:00Z")).day).toBe("2026-07-07");
  });

  it("parses the hour from a daily cron, else falls back to 6", () => {
    expect(parseRunHour("0 6 * * *")).toBe(6);
    expect(parseRunHour("30 9 * * *")).toBe(9);
    expect(parseRunHour("0 0 1 * *")).toBe(0);
    expect(parseRunHour(null)).toBe(6);
    expect(parseRunHour("garbage")).toBe(6);
    expect(parseRunHour("0 99 * * *")).toBe(6); // out of range
  });

  const base = { colomboDay: "2026-07-07", colomboHour: 8, runHour: 6, lastSyncDay: null as string | null, enabled: true };

  it("runs once when past the hour and not yet run today", () => {
    expect(shouldSyncNow(base)).toBe(true);
  });

  it("does not run again the same day", () => {
    expect(shouldSyncNow({ ...base, lastSyncDay: "2026-07-07" })).toBe(false);
  });

  it("runs again on a new day", () => {
    expect(shouldSyncNow({ ...base, lastSyncDay: "2026-07-06" })).toBe(true);
  });

  it("waits until the scheduled hour", () => {
    expect(shouldSyncNow({ ...base, colomboHour: 5 })).toBe(false);
  });

  it("does nothing when disabled", () => {
    expect(shouldSyncNow({ ...base, enabled: false })).toBe(false);
  });
});
