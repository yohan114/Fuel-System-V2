import { describe, it, expect } from "vitest";
import { parseSiteCodes, BILLING_DEFAULTS } from "../src/lib/billing/config";

// Guards the rule that stopped Badalgama Workshop billing Rs. 24.2M of
// guaranteed-minimum rental for machines parked at E&C's own yard.

describe("parseSiteCodes", () => {
  it("parses a comma separated list, tolerating spaces and case", () => {
    expect(parseSiteCodes("BADAL-WS")).toEqual(["BADAL-WS"]);
    expect(parseSiteCodes("BADAL-WS,HO")).toEqual(["BADAL-WS", "HO"]);
    expect(parseSiteCodes(" badal-ws , ho ")).toEqual(["BADAL-WS", "HO"]);
  });

  it("returns nothing for empty, blank or missing input, so billing is unchanged by default", () => {
    for (const raw of ["", "   ", ",", ",,", null, undefined]) {
      expect(parseSiteCodes(raw)).toEqual([]);
    }
    expect(BILLING_DEFAULTS.excludeSiteCodes).toBe("");
  });

  it("drops empty entries rather than producing a blank code", () => {
    // A blank code would match a vehicle with no site and silently stop billing it.
    expect(parseSiteCodes("BADAL-WS,,HO,")).toEqual(["BADAL-WS", "HO"]);
    expect(parseSiteCodes("BADAL-WS,,HO,").includes("")).toBe(false);
  });

  it("matches the codes the generator compares against (upper-cased)", () => {
    const excluded = parseSiteCodes("badal-ws");
    expect(excluded.includes("BADAL-WS".toUpperCase())).toBe(true);
    expect(excluded.includes("CEP-03F".toUpperCase())).toBe(false);
  });
});
