import { describe, expect, it } from "vitest";
import { resolveAuthSecret, DEV_FALLBACK_SECRET } from "../src/lib/auth-secret";

describe("resolveAuthSecret", () => {
  it("uses a configured secret in any environment", () => {
    expect(resolveAuthSecret("s3cret", "production")).toEqual({ secret: "s3cret", usedFallback: false });
    expect(resolveAuthSecret("s3cret", "development")).toEqual({ secret: "s3cret", usedFallback: false });
  });

  it("refuses to run production on a missing secret", () => {
    expect(() => resolveAuthSecret(undefined, "production")).toThrow(/AUTH_SECRET is not set/);
  });

  it("refuses to run production on the known development default", () => {
    expect(() => resolveAuthSecret(DEV_FALLBACK_SECRET, "production")).toThrow(/development default/);
  });

  it("falls back (flagged) in development", () => {
    expect(resolveAuthSecret(undefined, "development")).toEqual({
      secret: DEV_FALLBACK_SECRET,
      usedFallback: true,
    });
  });
});
