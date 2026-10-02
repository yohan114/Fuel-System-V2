import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, hasScope, roleAllowsScope } from "../src/lib/api/auth";
import { parsePagination, paginationMeta } from "../src/lib/api/pagination";
import { checkRateLimit } from "../src/lib/api/rate-limit";

describe("API Foundations: ApiKey & Scopes", () => {
  it("generates and hashes API keys consistently", () => {
    const key = generateApiKey("fs_live");
    expect(key.rawKey.startsWith("fs_live_")).toBe(true);
    expect(key.keyPrefix.startsWith("fs_live_")).toBe(true);
    expect(key.keyHash).toBe(hashApiKey(key.rawKey));
  });

  it("evaluates granted scopes accurately", () => {
    expect(hasScope("*", "read:fleet")).toBe(true);
    expect(hasScope("*", "write:fuel")).toBe(true);
    expect(hasScope("read:*", "read:fleet")).toBe(true);
    expect(hasScope("read:*", "write:fuel")).toBe(false);
    expect(hasScope("read:fleet,read:fuel", "read:fleet")).toBe(true);
    expect(hasScope("read:fleet,read:fuel", "write:fuel")).toBe(false);
    expect(hasScope("read:fleet", undefined)).toBe(true);
  });

  it("checks role permissions for scopes", () => {
    expect(roleAllowsScope("ADMIN", "write:anything")).toBe(true);
    expect(roleAllowsScope("USER", "read:fleet")).toBe(true);
    expect(roleAllowsScope("USER", "write:fuel")).toBe(false);
    expect(roleAllowsScope("WORKSHOP", "write:fuel")).toBe(true);
    expect(roleAllowsScope("SITE_PUMP", "write:fuel")).toBe(true);
  });
});

describe("API Foundations: Pagination", () => {
  it("parses pagination defaults", () => {
    const req = new Request("http://localhost/api/v1/assets");
    const p = parsePagination(req);
    expect(p.page).toBe(1);
    expect(p.perPage).toBe(20);
    expect(p.skip).toBe(0);
    expect(p.take).toBe(20);
  });

  it("parses custom page and limit with boundaries", () => {
    const req = new Request("http://localhost/api/v1/assets?page=3&per_page=50");
    const p = parsePagination(req);
    expect(p.page).toBe(3);
    expect(p.perPage).toBe(50);
    expect(p.skip).toBe(100);
    expect(p.take).toBe(50);
  });

  it("enforces max limit ceiling", () => {
    const req = new Request("http://localhost/api/v1/assets?limit=5000");
    const p = parsePagination(req, 20, 100);
    expect(p.perPage).toBe(100);
  });

  it("computes pagination metadata", () => {
    const meta = paginationMeta(95, 2, 20);
    expect(meta.total).toBe(95);
    expect(meta.total_pages).toBe(5);
    expect(meta.has_next).toBe(true);
    expect(meta.has_prev).toBe(true);
  });
});

describe("API Foundations: Rate Limiter", () => {
  it("allows tokens within limits and throttles when depleted", () => {
    const id = `test-client-${Date.now()}`;
    const r1 = checkRateLimit(id, 2, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = checkRateLimit(id, 2, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = checkRateLimit(id, 2, 60_000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });
});
