import { describe, expect, it } from "vitest";
import { summarizePayments } from "../src/lib/billing/payments";

describe("summarizePayments", () => {
  it("reports zero paid and full outstanding with no payments", () => {
    expect(summarizePayments(100_000, [])).toEqual({ paidCents: 0, outstandingCents: 100_000, fullyPaid: false });
  });
  it("tracks a partial balance", () => {
    const s = summarizePayments(100_000, [{ amountCents: 30_000 }, { amountCents: 20_000 }]);
    expect(s.paidCents).toBe(50_000);
    expect(s.outstandingCents).toBe(50_000);
    expect(s.fullyPaid).toBe(false);
  });
  it("marks fully paid once the ledger covers the total", () => {
    const s = summarizePayments(100_000, [{ amountCents: 60_000 }, { amountCents: 40_000 }]);
    expect(s.fullyPaid).toBe(true);
    expect(s.outstandingCents).toBe(0);
  });
  it("handles overpayment (negative outstanding, still fully paid)", () => {
    const s = summarizePayments(100_000, [{ amountCents: 120_000 }]);
    expect(s.outstandingCents).toBe(-20_000);
    expect(s.fullyPaid).toBe(true);
  });
  it("a zero-total bill is never 'fully paid' by an empty ledger", () => {
    expect(summarizePayments(0, []).fullyPaid).toBe(false);
  });
});
