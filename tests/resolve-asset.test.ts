import { describe, it, expect } from "vitest";
import { normKey } from "../src/lib/fleet/dedupe";
import { ambiguousAssetError } from "../src/lib/fleet/resolve-asset";

// resolveAsset itself hits the database; these cover the matching rule it is
// built on and the operator-facing message, which is what stops a typed
// registration variant from silently creating a duplicate vehicle.

describe("normKey — the identity used to match a typed vehicle", () => {
  it("treats punctuation and case variants of one registration as equal", () => {
    const target = normKey("ZA-0050");
    for (const typed of ["ZA0050", "za-0050", "ZA 0050", "za 0050", "Za-0050", " ZA-0050 "]) {
      expect(normKey(typed)).toBe(target);
    }
  });

  it("keeps genuinely different registrations apart", () => {
    // ZB-0050 is a different vehicle from ZA-0050 — a normalized match must not
    // collapse them, or fuel would post to the wrong machine.
    expect(normKey("ZB-0050")).not.toBe(normKey("ZA-0050"));
    expect(normKey("HO-9850")).not.toBe(normKey("LA-4229"));
    expect(normKey("DT-41")).not.toBe(normKey("DT-4"));
  });

  it("normalizes E&C codes the same way", () => {
    expect(normKey("hex-25")).toBe(normKey("HEX-25"));
    expect(normKey("HEX25")).toBe(normKey("HEX-25"));
  });

  it("is safe on empty and null input", () => {
    expect(normKey(null)).toBe("");
    expect(normKey(undefined)).toBe("");
    expect(normKey("")).toBe("");
    expect(normKey("---")).toBe("");
  });
});

describe("ambiguousAssetError", () => {
  it("names every candidate so the operator can pick the right one", () => {
    const msg = ambiguousAssetError(" 14160 ", ["HEX-25", "HEX-32", "HEX-33"]);
    expect(msg).toContain("14160");
    expect(msg).toContain("HEX-25");
    expect(msg).toContain("HEX-32");
    expect(msg).toContain("HEX-33");
    expect(msg).toContain("3 vehicles");
    // Trimmed, so the message does not read `" 14160 " matches`.
    expect(msg.startsWith('"14160"')).toBe(true);
  });
});
