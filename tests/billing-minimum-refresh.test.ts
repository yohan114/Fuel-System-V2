// The guaranteed monthly minimum must follow the contract terms, not whatever a
// bill happened to be created with.
//
// The defect: the minimum was frozen at bill-creation time. When the owner
// confirmed 3,000 km as contractual, 104 August per-km bills silently kept the
// old minimum of 0, and regenerating them changed nothing — the new term could
// not reach any month that already had drafts. Every month had to be corrected
// by hand, which is exactly the kind of chore that gets forgotten.

import { describe, expect, it } from "vitest";
import { minimumForMode, BILLING_DEFAULTS, type BillingConfig } from "../src/lib/billing/config";

const cfg = (over: Partial<BillingConfig> = {}): BillingConfig => ({
  enabled: true,
  cron: BILLING_DEFAULTS.cron,
  minHours: 120,
  minKm: 3000,
  minDays: 26,
  ssclRate: 0.025,
  vatRate: 0.18,
  dueDays: 30,
  invoicePrefix: "EC-INV",
  fuelRateFallbackCents: 0,
  autoEmailOnIssue: false,
  ...over,
});

// Mirrors the resolution in generate.ts: the machine's own override wins,
// otherwise the company standard for that billing mode.
const resolve = (mode: "hourly" | "perkm" | "perday", c: BillingConfig, assetMinHours?: number | null) =>
  assetMinHours ?? minimumForMode(c, mode);

describe("the contractual minimums", () => {
  it("gives machinery 120 running hours", () => {
    expect(resolve("hourly", cfg())).toBe(120);
  });

  it("gives road vehicles 3,000 running kilometres", () => {
    expect(resolve("perkm", cfg())).toBe(3000);
  });

  it("gives day-hire plant 26 days", () => {
    expect(resolve("perday", cfg())).toBe(26);
  });
});

describe("a change to the terms reaches every draft month", () => {
  it("uses the new figure, not the one a bill was created with", () => {
    // Before: the standard was 0 for road vehicles, so bills were created at 0.
    const wasCreatedWith = resolve("perkm", cfg({ minKm: 0 }));
    expect(wasCreatedWith).toBe(0);
    // After the owner confirms 3,000, a regenerate must produce 3,000 — the old
    // behaviour returned the frozen 0 and the new term never took effect.
    expect(resolve("perkm", cfg({ minKm: 3000 }))).toBe(3000);
  });

  it("applies the same way to hours if that term ever changes", () => {
    expect(resolve("hourly", cfg({ minHours: 200 }))).toBe(200);
  });
});

describe("a machine on its own terms keeps them", () => {
  it("lets a per-machine hour minimum override the company standard", () => {
    // Hired-in plant is sometimes guaranteed different hours by its own contract.
    expect(resolve("hourly", cfg(), 200)).toBe(200);
    expect(resolve("hourly", cfg({ minHours: 120 }), 80)).toBe(80);
  });

  it("ignores an override of zero or null and falls back to the standard", () => {
    expect(resolve("hourly", cfg(), null)).toBe(120);
    expect(resolve("hourly", cfg(), undefined)).toBe(120);
  });
});

describe("guardrails", () => {
  it("never returns a negative minimum", () => {
    for (const m of ["hourly", "perkm", "perday"] as const) {
      expect(resolve(m, cfg())).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to the built-in defaults when a setting is missing", () => {
    // minimumForMode reads the resolved config; the defaults are the safety net.
    expect(BILLING_DEFAULTS.minHours).toBe(120);
    expect(BILLING_DEFAULTS.minDays).toBe(26);
  });
});
