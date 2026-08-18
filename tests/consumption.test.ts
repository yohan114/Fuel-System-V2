import { describe, expect, it } from "vitest";
import { classifyConsumption } from "../src/lib/analytics/consumption";

describe("classifyConsumption", () => {
  const band = { econ: 5, typ: 7, heavy: 9.5 };

  it("flags burning above the heavy bound as a repair candidate", () => {
    expect(classifyConsumption(10.2, band.econ, band.typ, band.heavy)).toBe("OVER");
  });
  it("marks typ..heavy as heavy work / watch", () => {
    expect(classifyConsumption(8.2, band.econ, band.typ, band.heavy)).toBe("HEAVY");
    expect(classifyConsumption(9.5, band.econ, band.typ, band.heavy)).toBe("HEAVY"); // inclusive upper edge
  });
  it("treats econ..typ as normal", () => {
    expect(classifyConsumption(6, band.econ, band.typ, band.heavy)).toBe("NORMAL");
    expect(classifyConsumption(7, band.econ, band.typ, band.heavy)).toBe("NORMAL"); // typ itself is normal
    expect(classifyConsumption(5, band.econ, band.typ, band.heavy)).toBe("NORMAL"); // econ itself is normal
  });
  it("flags suspiciously light burn below econ", () => {
    expect(classifyConsumption(3.9, band.econ, band.typ, band.heavy)).toBe("BELOW_ECON");
  });
  it("handles missing meter and missing band", () => {
    expect(classifyConsumption(null, band.econ, band.typ, band.heavy)).toBe("NO_METER");
    expect(classifyConsumption(0, band.econ, band.typ, band.heavy)).toBe("NO_METER");
    expect(classifyConsumption(8, null, null, null)).toBe("NO_BAND");
  });
  it("classifies with a partial band (typ only)", () => {
    expect(classifyConsumption(8, null, 7, null)).toBe("HEAVY");
    expect(classifyConsumption(6, null, 7, null)).toBe("NORMAL");
  });
});
