// Voiding a fuel issue, and putting it back.
//
// "Delete" here does not erase. The row stays, flagged, and stops counting —
// the only version of deleting that leaves the audit entry something to point
// at, allows an undo, and survives a re-import: a dedup pass cannot recognise a
// row that is not there, so an erased issue returns the next time the sheet is
// loaded.
//
// Three things move when a litre is voided, and the round trip has to put all
// three back exactly. Verified against live data on LO-7855's 60 L of 31 July:
// the tank went 7,855.858 → 7,915.858 → 7,855.858, and its July draft went
// 275 L / Rs 506,085.04 → 215 L / Rs 478,000.45 → 275 L / Rs 506,085.04.

import { describe, expect, it } from "vitest";

/** Mirrors setVoided in src/app/actions/fuel-void.ts. */
function voidOutcome(o: {
  voided: boolean;                       // the state being requested
  currentlyVoided: boolean;
  litres: number;
  tankBalance: number | null;
  billStatus: "DRAFT" | "ISSUED" | "PAID" | null;
  reason: string;
  otherFuelThatMonth: number;
}):
  | { ok: false; error: string }
  | { ok: true; tankBalance: number | null; tankDelta: number; billAction: "redone" | "removed" | "none" } {
  if (o.currentlyVoided === o.voided) return { ok: false, error: "already in that state" };
  if (o.voided && o.reason.trim().length < 4) return { ok: false, error: "reason required" };
  if (o.billStatus && o.billStatus !== "DRAFT") return { ok: false, error: "invoice issued — credit note" };

  const delta = o.voided ? o.litres : -o.litres;
  if (!o.voided && o.tankBalance !== null && o.tankBalance < o.litres) {
    return { ok: false, error: "tank cannot give back what it does not hold" };
  }
  const billAction: "redone" | "removed" | "none" =
    o.billStatus !== "DRAFT" ? "none" : o.voided && o.otherFuelThatMonth === 0 ? "removed" : "redone";

  return {
    ok: true,
    tankBalance: o.tankBalance === null ? null : o.tankBalance + delta,
    tankDelta: delta,
    billAction,
  };
}

const base = {
  voided: true, currentlyVoided: false, litres: 60, tankBalance: 7855.858,
  billStatus: "DRAFT" as const, reason: "entered twice from the same sheet", otherFuelThatMonth: 3,
};

describe("voiding", () => {
  it("returns the litres to the tank", () => {
    const r = voidOutcome(base);
    expect(r).toMatchObject({ ok: true, tankDelta: 60, tankBalance: 7915.858 });
  });

  it("redoes the month's draft bill", () => {
    expect(voidOutcome(base)).toMatchObject({ billAction: "redone" });
  });

  it("removes the bill entirely when it was the machine's last fuel that month", () => {
    // Fuel is what qualifies a machine to be billed at all, so the last litre
    // going takes the bill with it rather than leaving a rental-only invoice.
    expect(voidOutcome({ ...base, otherFuelThatMonth: 0 })).toMatchObject({ billAction: "removed" });
  });

  it("touches no tank for a station purchase", () => {
    expect(voidOutcome({ ...base, tankBalance: null })).toMatchObject({ ok: true, tankBalance: null });
  });

  it("demands a reason", () => {
    expect(voidOutcome({ ...base, reason: "" })).toEqual({ ok: false, error: "reason required" });
    expect(voidOutcome({ ...base, reason: "x" })).toEqual({ ok: false, error: "reason required" });
  });

  it("refuses when the invoice has gone to the client", () => {
    // AC-25's July invoice, EC-INV-2026-0001. Fuel disappearing from under a
    // bill the client holds is a credit note's business.
    expect(voidOutcome({ ...base, billStatus: "ISSUED" })).toEqual({ ok: false, error: "invoice issued — credit note" });
    expect(voidOutcome({ ...base, billStatus: "PAID" })).toEqual({ ok: false, error: "invoice issued — credit note" });
  });

  it("refuses to void what is already void", () => {
    expect(voidOutcome({ ...base, currentlyVoided: true })).toEqual({ ok: false, error: "already in that state" });
  });

  it("proceeds where no bill exists for the month", () => {
    expect(voidOutcome({ ...base, billStatus: null })).toMatchObject({ ok: true, billAction: "none" });
  });
});

describe("restoring", () => {
  const undo = { ...base, voided: false, currentlyVoided: true, tankBalance: 7915.858, reason: "" };

  it("takes the litres back out of the tank", () => {
    expect(voidOutcome(undo)).toMatchObject({ ok: true, tankDelta: -60, tankBalance: 7855.858 });
  });

  it("needs no reason — putting a mistake back is not a decision to justify", () => {
    expect(voidOutcome(undo)).toMatchObject({ ok: true });
  });

  it("refuses when the tank no longer holds the litres it would take back", () => {
    expect(voidOutcome({ ...undo, tankBalance: 20 })).toEqual({
      ok: false, error: "tank cannot give back what it does not hold",
    });
  });

  it("refuses to restore what is not void", () => {
    expect(voidOutcome({ ...undo, currentlyVoided: false })).toEqual({ ok: false, error: "already in that state" });
  });
});

describe("the round trip", () => {
  it("leaves the tank exactly where it started", () => {
    const start = 7855.858;
    const gone = voidOutcome({ ...base, tankBalance: start });
    expect(gone.ok).toBe(true);
    const back = voidOutcome({
      ...base, voided: false, currentlyVoided: true, reason: "",
      tankBalance: (gone as { tankBalance: number }).tankBalance,
    });
    expect((back as { tankBalance: number }).tankBalance).toBeCloseTo(start, 6);
  });
});
