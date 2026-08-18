import { describe, expect, it } from "vitest";
import { assetSearchClause, assetMatchesSearch } from "../src/lib/fleet/asset-search";

describe("assetSearchClause", () => {
  it("searches the vehicle number as well as the E&C number", () => {
    const c = assetSearchClause("ZB-2587");
    expect(c).not.toBeNull();
    const fields = c!.OR.map((o) => Object.keys(o)[0]);
    expect(fields).toContain("code");
    expect(fields).toContain("regNo");
  });

  it("does not fold case — SQLite LIKE is already case-insensitive", () => {
    const c = assetSearchClause("zb-2587");
    expect(JSON.stringify(c)).toContain("zb-2587");
  });

  it("trims surrounding whitespace from a pasted number", () => {
    const c = assetSearchClause("  LB-23  ");
    expect(JSON.stringify(c)).toContain('"LB-23"');
  });

  it("returns null for an empty search so no filter is applied", () => {
    expect(assetSearchClause("")).toBeNull();
    expect(assetSearchClause("   ")).toBeNull();
  });
});

describe("assetMatchesSearch", () => {
  // LB-23 is the E&C number; ZB-2587 is painted on the vehicle.
  const asset = { code: "LB-23", regNo: "ZB-2587", brand: "BOB CAT", model: "B760" };

  it("finds a machine by its vehicle number — the reported bug", () => {
    expect(assetMatchesSearch(asset, "ZB-2587")).toBe(true);
    expect(assetMatchesSearch(asset, "2587")).toBe(true);
  });

  it("still finds it by E&C number", () => {
    expect(assetMatchesSearch(asset, "LB-23")).toBe(true);
  });

  it("is case-insensitive either way", () => {
    expect(assetMatchesSearch(asset, "zb-2587")).toBe(true);
    expect(assetMatchesSearch(asset, "bob cat")).toBe(true);
  });

  it("matches make and model", () => {
    expect(assetMatchesSearch(asset, "B760")).toBe(true);
  });

  it("does not match an unrelated term", () => {
    expect(assetMatchesSearch(asset, "ZZ-9999")).toBe(false);
  });

  it("copes with a machine that has no registration number", () => {
    expect(assetMatchesSearch({ code: "GEN-01", regNo: null }, "GEN-01")).toBe(true);
    expect(assetMatchesSearch({ code: "GEN-01", regNo: null }, "ZB-2587")).toBe(false);
  });

  it("treats an empty term as no filter", () => {
    expect(assetMatchesSearch(asset, "  ")).toBe(true);
  });
});
