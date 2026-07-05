import { describe, expect, it } from "vitest";
import { normalizePN, parseSupplierCode } from "../src/lib/filters/normalize";

describe("normalizePN", () => {
  it("collapses case, spaces and dashes", () => {
    expect(normalizePN("SO 10058")).toBe("SO10058");
    expect(normalizePN("so-10058")).toBe("SO10058");
    expect(normalizePN("P55-8615")).toBe("P558615");
    expect(normalizePN(null)).toBe("");
  });
});

describe("parseSupplierCode", () => {
  it("splits the code from the quoting supplier", () => {
    expect(parseSupplierCode("C115 (VIC Japan)")).toEqual({ code: "C115", supplier: "VIC Japan" });
    expect(parseSupplierCode("0149 (Komten)")).toEqual({ code: "0149", supplier: "Komten" });
  });
  it("passes plain codes through", () => {
    expect(parseSupplierCode("LF9028")).toEqual({ code: "LF9028", supplier: null });
  });
});
