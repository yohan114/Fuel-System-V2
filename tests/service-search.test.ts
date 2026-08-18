// Searching the service planner for a machine.
//
// A machine is known by two numbers: the E&C number the office uses (HEX-26) and
// the number plate the yard uses (ZA-2609). People type either, and they type it
// the way they say it — with a space, with a dash, or with nothing at all — so
// the match ignores punctuation and case on both sides.

import { describe, expect, it } from "vitest";

// Mirror of the matcher in src/app/(dashboard)/service/page.tsx. Kept here as the
// specification of the behaviour; the page imports nothing so this stays a pure
// contract test.
function matchesSearch(r: { code: string; regNo: string | null }, query: string): boolean {
  const squash = (s: string) => s.replace(/[-\s/().]/g, "").toUpperCase();
  const q = squash(query);
  if (!q) return true;
  return squash(r.code).includes(q) || (!!r.regNo && squash(r.regNo).includes(q));
}

const HEX26 = { code: "HEX-26", regNo: null };
const LB01 = { code: "LB-01", regNo: "ZA-2609" };
const SLASH = { code: "VR-14/VR-65", regNo: null };

describe("finding a machine by its E&C number", () => {
  it("matches the number as written", () => {
    expect(matchesSearch(HEX26, "HEX-26")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesSearch(HEX26, "hex-26")).toBe(true);
  });

  it("ignores the dash — people type it either way", () => {
    expect(matchesSearch(HEX26, "HEX26")).toBe(true);
    expect(matchesSearch(HEX26, "hex 26")).toBe(true);
  });

  it("matches a partial number, so typing the digits finds it", () => {
    expect(matchesSearch(HEX26, "26")).toBe(true);
    expect(matchesSearch(HEX26, "HEX")).toBe(true);
  });

  it("does not match an unrelated machine", () => {
    expect(matchesSearch(HEX26, "LB-01")).toBe(false);
  });
});

describe("finding a machine by its vehicle number", () => {
  it("matches the plate", () => {
    expect(matchesSearch(LB01, "ZA-2609")).toBe(true);
  });

  it("matches the plate typed without a dash or with a space", () => {
    expect(matchesSearch(LB01, "ZA2609")).toBe(true);
    expect(matchesSearch(LB01, "za 2609")).toBe(true);
  });

  it("matches on just the digits of the plate", () => {
    expect(matchesSearch(LB01, "2609")).toBe(true);
  });

  it("still finds the same machine by its E&C number", () => {
    expect(matchesSearch(LB01, "LB-01")).toBe(true);
  });

  it("does not match a machine with no plate on a plate search", () => {
    expect(matchesSearch(HEX26, "ZA-2609")).toBe(false);
  });
});

describe("edge cases", () => {
  it("an empty search shows everything", () => {
    expect(matchesSearch(HEX26, "")).toBe(true);
    expect(matchesSearch(HEX26, "   ")).toBe(true);
  });

  it("handles codes that contain a slash", () => {
    expect(matchesSearch(SLASH, "VR-14/VR-65")).toBe(true);
    expect(matchesSearch(SLASH, "VR14VR65")).toBe(true);
    expect(matchesSearch(SLASH, "VR-65")).toBe(true);
  });

  it("does not crash on a machine with no plate", () => {
    expect(() => matchesSearch({ code: "AC-01", regNo: null }, "x")).not.toThrow();
  });
});
