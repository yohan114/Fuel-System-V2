import { describe, expect, it } from "vitest";
import { parseWorkshopMeter, PLATE_SHAPE } from "../src/lib/service/workshop-sync";

describe("PLATE_SHAPE — what may be accepted as a number plate", () => {
  it("accepts real Sri Lankan plates", () => {
    for (const p of ["ZA-2609", "LN-8277", "BET-8556", "PH-3945", "49-2288", "325-5120"]) {
      expect(PLATE_SHAPE.test(p), p).toBe(true);
    }
  });

  it("rejects the model names and serials sitting in WorkshopOne's registration column", () => {
    // "FIORI" is a mixer brand on 3 assets; "14160" is a serial on 3 more.
    for (const junk of ["FIORI", "14160", "WATER PUMP", "ASP PAVER", "GE-48 yanmar AG45SS", ""]) {
      expect(PLATE_SHAPE.test(junk), junk).toBe(false);
    }
  });
});

describe("parseWorkshopMeter", () => {
  it("reads the number and the unit WorkshopOne attaches", () => {
    expect(parseWorkshopMeter("142788 km")).toEqual({ value: 142788, unit: "KM", text: null });
    expect(parseWorkshopMeter("05 Hrs")).toEqual({ value: 5, unit: "HOURS", text: null });
    expect(parseWorkshopMeter("617743Km")).toEqual({ value: 617743, unit: "KM", text: null });
  });

  it("reads a bare number with no unit", () => {
    expect(parseWorkshopMeter("2410")).toEqual({ value: 2410, unit: null, text: null });
  });

  it("keeps 'meter not working' as text rather than inventing a number", () => {
    const r = parseWorkshopMeter("MNW");
    expect(r.value).toBeNull();
    expect(r.text).toBe("MNW");
  });

  it("treats zero as no reading — a zero would look like a machine at hour nought", () => {
    expect(parseWorkshopMeter("0").value).toBeNull();
    expect(parseWorkshopMeter("0 Hrs").value).toBeNull();
  });

  it("handles blank and null", () => {
    expect(parseWorkshopMeter("")).toEqual({ value: null, unit: null, text: null });
    expect(parseWorkshopMeter(null)).toEqual({ value: null, unit: null, text: null });
  });

  it("keeps decimals", () => {
    expect(parseWorkshopMeter("1234.5 km").value).toBe(1234.5);
  });
});
