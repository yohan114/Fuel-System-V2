// The owner's arrival-billing rules, encoded so the defect cannot return.
//
// The defect: presence at a site was inferred from fuel draws, so a vehicle that
// never left was re-billed as a new arrival every month, prorated from that
// month's first fuel issue. The rule is that a vehicle arrives ONCE; the arrival
// month is prorated and every month after it is a full standard month.

import { describe, expect, it } from "vitest";
import {
  colomboDay,
  inclusiveDays,
  minimumForWindow,
  proratedCharge,
  resolveBillingWindow,
  resolveInitialArrival,
  STANDARD_MINIMUM,
} from "../src/lib/billing/arrival";

// Colombo midnight, the way every date in this system is stored.
const day = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const JAN = { start: day("2026-01-01"), end: day("2026-01-31") };
const FEB = { start: day("2026-02-01"), end: day("2026-02-28") };
const MAR = { start: day("2026-03-01"), end: day("2026-03-31") };

describe("section 1 — the arrival date is decided once", () => {
  it("prefers an approved allocation start over any fuel issue", () => {
    const a = resolveInitialArrival({
      allocationStarts: [day("2026-01-15")],
      fuelIssueDates: [day("2026-01-20"), day("2026-02-05")],
    })!;
    expect(colomboDay(a.date)).toBe("2026-01-15");
    expect(a.source).toBe("ALLOCATION_START");
  });

  it("falls back to the FIRST fuel issue ever — not the first of a later month", () => {
    // The whole defect in one assertion: February's draws must not win.
    const a = resolveInitialArrival({
      allocationStarts: [],
      fuelIssueDates: [day("2026-02-05"), day("2026-01-20"), day("2026-02-18")],
    })!;
    expect(colomboDay(a.date)).toBe("2026-01-20");
    expect(a.source).toBe("FIRST_FUEL_ISSUE");
    expect(a.billingMonth).toBe("2026-01");
  });

  it("lets a Finance/Admin correction outrank both", () => {
    const a = resolveInitialArrival({
      allocationStarts: [day("2026-01-15")],
      fuelIssueDates: [day("2026-01-20")],
      manualOverride: day("2026-01-10"),
    })!;
    expect(colomboDay(a.date)).toBe("2026-01-10");
    expect(a.source).toBe("MANUAL_CORRECTION");
  });

  it("returns nothing when there is no evidence at all", () => {
    expect(resolveInitialArrival({ allocationStarts: [], fuelIssueDates: [] })).toBeNull();
  });
});

describe("section 7 — the February test case, which must pass", () => {
  // LO-9999: first approved fuel issue at the site 20 January, no allocation.
  // February draws on the 5th, 10th, 18th and 20th.
  const arrival = resolveInitialArrival({
    allocationStarts: [],
    fuelIssueDates: [
      day("2026-01-20"),
      day("2026-02-05"), day("2026-02-10"), day("2026-02-18"), day("2026-02-20"),
    ],
  })!;

  it("sets the initial arrival to 20 January", () => {
    expect(colomboDay(arrival.date)).toBe("2026-01-20");
    expect(arrival.billingMonth).toBe("2026-01");
  });

  it("bills January from 20 to 31 January — 12 days", () => {
    const w = resolveBillingWindow({ monthStart: JAN.start, monthEnd: JAN.end, arrival });
    expect(w.treatment).toBe("FIRST_ARRIVAL_PRORATED");
    expect(colomboDay(w.from!)).toBe("2026-01-20");
    expect(colomboDay(w.to!)).toBe("2026-01-31");
    expect(w.billableDays).toBe(12);
    expect(w.isFullMonth).toBe(false);
  });

  it("bills the WHOLE of February — not from the 5th", () => {
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival });
    expect(w.treatment).toBe("STANDARD");
    expect(colomboDay(w.from!)).toBe("2026-02-01");
    expect(colomboDay(w.to!)).toBe("2026-02-28");
    expect(w.billableDays).toBe(28);
    expect(w.isFullMonth).toBe(true);
  });

  it("does not create a second arrival in February", () => {
    // Re-deriving from February's own fuel would give the 5th. It must not.
    const wrong = resolveInitialArrival({
      allocationStarts: [],
      fuelIssueDates: [day("2026-02-05"), day("2026-02-10")],
    })!;
    expect(colomboDay(wrong.date)).toBe("2026-02-05"); // what monthly re-derivation would produce
    // The real arrival, from the full history, stays in January.
    expect(colomboDay(arrival.date)).toBe("2026-01-20");
    expect(arrival.billingMonth).not.toBe("2026-02");
  });

  it("keeps billing full months from March on", () => {
    const w = resolveBillingWindow({ monthStart: MAR.start, monthEnd: MAR.end, arrival });
    expect(w.treatment).toBe("STANDARD");
    expect(w.billableDays).toBe(31);
    expect(w.isFullMonth).toBe(true);
  });
});

describe("section 2 — the prorated first month", () => {
  it("matches the owner's formula: monthly rate / days in month x billable days", () => {
    const arrival = resolveInitialArrival({ allocationStarts: [], fuelIssueDates: [day("2026-01-20")] })!;
    const w = resolveBillingWindow({ monthStart: JAN.start, monthEnd: JAN.end, arrival });
    // Rs 300,000 monthly, January, 12 billable days.
    expect(proratedCharge(30_000_000, w)).toBe(Math.round((30_000_000 / 31) * 12));
    expect(proratedCharge(30_000_000, w)).toBe(11_612_903); // Rs 116,129.03
  });

  it("charges the full rate for a whole month, with no rounding drift", () => {
    const arrival = resolveInitialArrival({ allocationStarts: [], fuelIssueDates: [day("2026-01-20")] })!;
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival });
    expect(proratedCharge(30_000_000, w)).toBe(30_000_000);
  });
});

describe("section 4 — the standard monthly minimum", () => {
  const arrival = resolveInitialArrival({ allocationStarts: [], fuelIssueDates: [day("2026-01-20")] })!;

  it("guarantees 120 hours or 3,000 km for a full month", () => {
    expect(STANDARD_MINIMUM.HOURS).toBe(120);
    expect(STANDARD_MINIMUM.KM).toBe(3000);
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival });
    expect(minimumForWindow("HOURS", w)).toBe(120);
    expect(minimumForWindow("KM", w)).toBe(3000);
  });

  it("prorates the guarantee in the arrival month only", () => {
    const w = resolveBillingWindow({ monthStart: JAN.start, monthEnd: JAN.end, arrival });
    expect(minimumForWindow("HOURS", w)).toBeCloseTo(120 * (12 / 31), 6);
    expect(minimumForWindow("KM", w)).toBeCloseTo(3000 * (12 / 31), 6);
  });

  it("is not reduced by fuel being drawn on only a few days", () => {
    // February had four draws. The month is still whole, so the guarantee is whole.
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival });
    expect(minimumForWindow("KM", w)).toBe(3000);
  });

  it("honours a per-vehicle override", () => {
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival });
    expect(minimumForWindow("HOURS", w, 200)).toBe(200);
  });
});

describe("section 6 — transfers", () => {
  const arrival = resolveInitialArrival({ allocationStarts: [day("2025-11-01")], fuelIssueDates: [] })!;

  it("prorates from the transfer date when a vehicle moves in", () => {
    const w = resolveBillingWindow({
      monthStart: FEB.start, monthEnd: FEB.end, arrival, transferInDate: day("2026-02-10"),
    });
    expect(w.treatment).toBe("TRANSFER_IN_PRORATED");
    expect(colomboDay(w.from!)).toBe("2026-02-10");
    expect(w.billableDays).toBe(19);
  });

  it("ends the old site the day BEFORE the transfer", () => {
    const w = resolveBillingWindow({
      monthStart: FEB.start, monthEnd: FEB.end, arrival, transferOutDate: day("2026-02-10"),
    });
    expect(w.treatment).toBe("TRANSFER_OUT_PRORATED");
    expect(colomboDay(w.to!)).toBe("2026-02-09");
    expect(w.billableDays).toBe(9);
  });

  it("handles in and out inside one month without exceeding it", () => {
    const w = resolveBillingWindow({
      monthStart: FEB.start, monthEnd: FEB.end, arrival,
      transferInDate: day("2026-02-05"), transferOutDate: day("2026-02-20"),
    });
    expect(w.treatment).toBe("PART_MONTH");
    expect(w.billableDays).toBe(15); // 5th to 19th inclusive
    expect(w.billableDays).toBeLessThan(w.daysInMonth);
  });
});

describe("section 8 — validations", () => {
  const arrival = resolveInitialArrival({ allocationStarts: [], fuelIssueDates: [day("2026-01-20")] })!;

  it("never bills a month before the vehicle arrived", () => {
    const dec = resolveBillingWindow({
      monthStart: day("2025-12-01"), monthEnd: day("2025-12-31"), arrival,
    });
    expect(dec.treatment).toBe("NOT_AT_SITE");
    expect(dec.billableDays).toBe(0);
  });

  it("never bills more days than the month holds", () => {
    for (const m of [JAN, FEB, MAR]) {
      const w = resolveBillingWindow({ monthStart: m.start, monthEnd: m.end, arrival });
      expect(w.billableDays).toBeLessThanOrEqual(w.daysInMonth);
    }
  });

  it("bills nothing when the vehicle is not posted at the site", () => {
    const w = resolveBillingWindow({ monthStart: FEB.start, monthEnd: FEB.end, arrival, notAtSite: true });
    expect(w.treatment).toBe("NOT_AT_SITE");
    expect(w.billableDays).toBe(0);
  });

  it("refuses a window that ends before it starts", () => {
    const w = resolveBillingWindow({
      monthStart: FEB.start, monthEnd: FEB.end, arrival,
      transferInDate: day("2026-02-20"), transferOutDate: day("2026-02-05"),
    });
    expect(w.treatment).toBe("NOT_AT_SITE");
  });
});

describe("leap years and month lengths", () => {
  it("counts February 2028 as 29 days", () => {
    const arrival = resolveInitialArrival({ allocationStarts: [day("2027-01-01")], fuelIssueDates: [] })!;
    const w = resolveBillingWindow({
      monthStart: day("2028-02-01"), monthEnd: day("2028-02-29"), arrival,
    });
    expect(w.daysInMonth).toBe(29);
    expect(w.billableDays).toBe(29);
    expect(w.isFullMonth).toBe(true);
  });

  it("counts inclusive days correctly across the Colombo boundary", () => {
    expect(inclusiveDays(day("2026-01-20"), day("2026-01-31"))).toBe(12);
    expect(inclusiveDays(day("2026-02-01"), day("2026-02-28"))).toBe(28);
    expect(inclusiveDays(day("2026-01-01"), day("2026-01-01"))).toBe(1);
  });
});
