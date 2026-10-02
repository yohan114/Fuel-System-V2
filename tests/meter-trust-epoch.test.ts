import { describe, expect, it } from "vitest";
import { meterDeltaUsable } from "../src/lib/service/meter-trust";

describe("meterDeltaUsable with Instrument Epochs", () => {
  it("allows normal delta when readings are on the same instrument with no replacement", () => {
    const res = meterDeltaUsable({
      meterAtService: 15000,
      currentMeter: 15450,
      meterType: "KM",
      replacementDate: null,
    });

    expect(res.usable).toBe(true);
    expect(res.delta).toBe(450);
    expect(res.reason).toMatch(/meter read 15,000 at the service and 15,450 at the last fuel issue/);
  });

  it("rejects meter subtraction across an instrument replacement epoch", () => {
    const res = meterDeltaUsable({
      meterAtService: 198500,
      currentMeter: 1200,
      meterType: "KM",
      replacementDate: "2026-08-15",
    });

    expect(res.usable).toBe(false);
    expect(res.delta).toBeNull();
    expect(res.reason).toContain("meter was replaced on 2026-08-15; the two readings are not the same instrument");
  });

  it("formats Date object replacementDate in Colombo timezone", () => {
    const repDate = new Date("2026-09-10T00:00:00+05:30");
    const res = meterDeltaUsable({
      meterAtService: 4500,
      currentMeter: 50,
      meterType: "HOURS",
      replacementDate: repDate,
    });

    expect(res.usable).toBe(false);
    expect(res.delta).toBeNull();
    expect(res.reason).toContain("meter was replaced on 2026-09-10; the two readings are not the same instrument");
  });

  it("rejects backwards meters when no replacement date was recorded", () => {
    const res = meterDeltaUsable({
      meterAtService: 50000,
      currentMeter: 48000,
      meterType: "KM",
      replacementDate: null,
    });

    expect(res.usable).toBe(false);
    expect(res.delta).toBeNull();
    expect(res.reason).toMatch(/meter has gone backwards since the service/);
  });

  it("rejects missing readings", () => {
    const res = meterDeltaUsable({
      meterAtService: null,
      currentMeter: 1000,
      meterType: "KM",
    });

    expect(res.usable).toBe(false);
    expect(res.delta).toBeNull();
    expect(res.reason).toBe("no meter pair to subtract");
  });
});
