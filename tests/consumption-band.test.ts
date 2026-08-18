import { describe, expect, it } from "vitest";
import {
  consBasisForMode,
  displayUnit,
  formatCons,
  fromDisplay,
  isPlausibleRate,
  resolveBand,
  toDisplay,
} from "../src/lib/consumption/band";

describe("unit conversion", () => {
  it("leaves hour machines alone — L/hr is stored and shown", () => {
    expect(toDisplay(8, "hr")).toBe(8);
    expect(fromDisplay(8, "hr")).toBe(8);
    expect(displayUnit("hr")).toBe("L/hr");
  });

  it("inverts road vehicles: the DB holds L/km, the sheet and the screen say km/L", () => {
    // BD-05 in the live data: 0.4 L/km is 2.5 km/L.
    expect(toDisplay(0.4, "km")).toBeCloseTo(2.5, 10);
    expect(fromDisplay(2.5, "km")).toBeCloseTo(0.4, 10);
    expect(displayUnit("km")).toBe("km/L");
  });

  it("round-trips", () => {
    for (const v of [0.0222, 0.1, 0.3125, 0.4545]) {
      expect(fromDisplay(toDisplay(v, "km"), "km")).toBeCloseTo(v, 10);
    }
  });

  it("refuses zero and negative rather than returning Infinity", () => {
    expect(toDisplay(0, "km")).toBeNull();
    expect(toDisplay(-1, "km")).toBeNull();
    expect(toDisplay(null, "km")).toBeNull();
    expect(formatCons(0, "km")).toBe("—");
  });

  it("inverting reverses the ordering — econ is the biggest number in km/L", () => {
    // Storage: econ < typ < heavy (higher is worse).
    const econ = 0.3125, typ = 0.4, heavy = 0.5;
    const dEcon = toDisplay(econ, "km")!, dTyp = toDisplay(typ, "km")!, dHeavy = toDisplay(heavy, "km")!;
    expect(dEcon).toBeGreaterThan(dTyp);
    expect(dTyp).toBeGreaterThan(dHeavy);
  });
});

describe("resolveBand", () => {
  const band = { fuelConsEcon: 5, fuelConsTyp: 7, fuelConsHeavy: 9.45, fuelConsBasis: "hr" };

  it("compares when the band basis matches the meter", () => {
    const r = resolveBand(band, "HOURS");
    expect(r.comparable).toBe(true);
    expect(r.typ).toBe(7);
    expect(r.displayUnit).toBe("L/hr");
  });

  it("refuses to compare an hour band against a km meter — the 95-machine case", () => {
    const r = resolveBand(band, "KM");
    expect(r.comparable).toBe(false);
    expect(r.reason).toBe("basis-conflict");
    // The stored values are still reported, so the rate card can be shown.
    expect(r.rawTyp).toBe(7);
    // but never offered for comparison
    expect(r.typ).toBeNull();
  });

  it("treats a zero band (towed trailers) as no band, not as a real value", () => {
    const r = resolveBand({ fuelConsEcon: 0, fuelConsTyp: 0, fuelConsHeavy: 0, fuelConsBasis: "km" }, "KM");
    expect(r.comparable).toBe(false);
    expect(r.reason).toBe("no-band");
  });

  it("reports a missing rate card distinctly from a card with no band", () => {
    expect(resolveBand(null, "KM").reason).toBe("no-rate-card");
    expect(resolveBand({ fuelConsTyp: null }, "KM").reason).toBe("no-band");
  });

  it("infers an unlabelled basis from magnitude instead of trusting the meter", () => {
    // 0.1 can only be litres per km; 12 can only be litres per hour.
    expect(resolveBand({ fuelConsTyp: 0.1, fuelConsBasis: null }, "KM").comparable).toBe(true);
    expect(resolveBand({ fuelConsTyp: 12, fuelConsBasis: null }, "KM").reason).toBe("basis-conflict");
    expect(resolveBand({ fuelConsTyp: 12, fuelConsBasis: null }, "HOURS").comparable).toBe(true);
  });
});

describe("billing mode to basis", () => {
  it("maps the two metered modes and leaves day hire without a band", () => {
    expect(consBasisForMode("hourly")).toBe("hr");
    expect(consBasisForMode("perkm")).toBe("km");
    expect(consBasisForMode("perday")).toBeNull();
  });
});

describe("plausibility floor", () => {
  it("rejects the measurement artefacts that would top the repair list", () => {
    // DC-24: 30 L over a 23 km reading gap = 1.30 L/km (0.77 km/L).
    expect(isPlausibleRate(30 / 23, "km")).toBe(false);
    // A real Hilux at 10 km/L = 0.1 L/km.
    expect(isPlausibleRate(0.1, "km")).toBe(true);
    // A real excavator at 16 L/hr.
    expect(isPlausibleRate(16, "hr")).toBe(true);
    // SL-05: 20 L over 1.8 recorded hours.
    expect(isPlausibleRate(20 / 1.8, "hr")).toBe(true); // 11 L/hr is possible…
    expect(isPlausibleRate(200, "hr")).toBe(false); // …200 is not
  });
});
