import { describe, expect, it } from "vitest";
import { findSimilarProject, normaliseSiteName } from "../src/lib/site-name";

describe("normaliseSiteName", () => {
  it("strips the part-of-site qualifiers that caused the Badalgama split", () => {
    expect(normaliseSiteName("Badalgama")).toBe("badalgama");
    expect(normaliseSiteName("Badalgama Plant")).toBe("badalgama");
    expect(normaliseSiteName("Badalgama Workshop")).toBe("badalgama");
    expect(normaliseSiteName("  badalgama-PLANT ")).toBe("badalgama");
  });

  it("keeps genuinely different sites apart", () => {
    expect(normaliseSiteName("CEP-03 E Package")).not.toBe(normaliseSiteName("CEP-03 F Package"));
    expect(normaliseSiteName("EP I-Road Lot-03")).not.toBe(normaliseSiteName("EP I-Road Lot-04"));
    expect(normaliseSiteName("Marawila")).not.toBe(normaliseSiteName("Mannarama"));
  });
});

describe("findSimilarProject", () => {
  const existing = [
    { id: "1", name: "Badalgama Plant", code: "BADAL" },
    { id: "2", name: "Marawila", code: "MRW" },
    { id: "3", name: "CEP-03 Wadakada", code: "CEP03W" },
  ];

  it("catches a second Badalgama under a different qualifier", () => {
    expect(findSimilarProject("Badalgama Workshop", existing)?.code).toBe("BADAL");
    expect(findSimilarProject("Badalgama", existing)?.code).toBe("BADAL");
  });

  it("allows a genuinely new site", () => {
    expect(findSimilarProject("Kotugoda Plant", existing)).toBeNull();
    expect(findSimilarProject("CEP-03 Wadakada Plants", existing)?.code).toBe("CEP03W");
  });

  // "Workshop" alone normalises to "" — it must not collide with every site.
  it("never matches on a name made only of qualifiers", () => {
    expect(findSimilarProject("Workshop", existing)).toBeNull();
    expect(findSimilarProject("Main Store", existing)).toBeNull();
  });
});
