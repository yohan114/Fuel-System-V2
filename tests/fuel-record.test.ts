// Recording a fuel issue by hand.
//
// Two things were wrong with the way this worked. It accepted the current day
// and nothing else — right for an operator standing at a pump, wrong for an
// office entering a week of paper sheets, and part of why so much of this
// fleet's fuel arrives by bulk import instead. And it never asked which pump,
// so every issue logged this way left the tank balances untouched: this
// database reads 7,856 L at Badalgama where the site instance reads 727 L.
//
// Now: a pump may be named and its balance moves with the litres; a station
// purchase names none, which is honest because there is no tank behind it; and
// an admin may date it back, saying why once it is more than a week.

import { describe, expect, it } from "vitest";

const BACKDATE_FREE_DAYS = 7;

/** Mirrors the date gate in recordDirectIssueAction. */
function dateAllowed(o: {
  issueDay: string;
  today: string;
  isAdmin: boolean;
  reason: string;
}): { ok: true } | { ok: false; error: string } {
  if (o.issueDay > o.today) return { ok: false, error: "future" };
  if (!o.isAdmin && o.issueDay !== o.today) return { ok: false, error: "today only" };
  if (o.isAdmin) {
    const days = Math.round(
      (new Date(`${o.today}T00:00:00+05:30`).getTime() - new Date(`${o.issueDay}T00:00:00+05:30`).getTime()) / 86_400_000,
    );
    if (days > BACKDATE_FREE_DAYS && o.reason.trim().length < 4) return { ok: false, error: "reason required" };
  }
  return { ok: true };
}

/** Mirrors the pump gate. */
function tankAllowed(o: {
  tank: { name: string; balance: number; fuelKind: string } | null;
  litres: number;
  fuelKind: string;
}): { ok: true; balanceAfter: number | null; source: string | null } | { ok: false; error: string } {
  if (!o.tank) return { ok: true, balanceAfter: null, source: null };
  if (o.tank.fuelKind !== o.fuelKind) return { ok: false, error: "wrong product" };
  if (o.tank.balance < o.litres) return { ok: false, error: "not enough in the tank" };
  return { ok: true, balanceAfter: o.tank.balance - o.litres, source: o.tank.name };
}

const TODAY = "2026-08-23";

describe("when it may be dated", () => {
  it("takes today", () => {
    expect(dateAllowed({ issueDay: TODAY, today: TODAY, isAdmin: true, reason: "" })).toEqual({ ok: true });
  });

  it("refuses the future, admin or not", () => {
    expect(dateAllowed({ issueDay: "2026-08-24", today: TODAY, isAdmin: true, reason: "anything" }))
      .toEqual({ ok: false, error: "future" });
  });

  it("holds an operator to today", () => {
    expect(dateAllowed({ issueDay: "2026-08-22", today: TODAY, isAdmin: false, reason: "the sheet came late" }))
      .toEqual({ ok: false, error: "today only" });
  });

  it("lets an admin enter last week's sheets without ceremony", () => {
    // The ordinary case: a site sends Monday's paperwork on Friday.
    for (const d of ["2026-08-22", "2026-08-20", "2026-08-16"]) {
      expect(dateAllowed({ issueDay: d, today: TODAY, isAdmin: true, reason: "" })).toEqual({ ok: true });
    }
  });

  it("asks why once it is more than a week back", () => {
    expect(dateAllowed({ issueDay: "2026-08-15", today: TODAY, isAdmin: true, reason: "" }))
      .toEqual({ ok: false, error: "reason required" });
    expect(dateAllowed({ issueDay: "2026-08-15", today: TODAY, isAdmin: true, reason: "Marawila's paper sheets" }))
      .toEqual({ ok: true });
  });

  it("takes exactly seven days back without a reason, eight with one", () => {
    expect(dateAllowed({ issueDay: "2026-08-16", today: TODAY, isAdmin: true, reason: "" })).toEqual({ ok: true });
    expect(dateAllowed({ issueDay: "2026-08-15", today: TODAY, isAdmin: true, reason: "" }).ok).toBe(false);
  });

  it("lets a closed month be reached, but only with the reason on the record", () => {
    expect(dateAllowed({ issueDay: "2026-06-14", today: TODAY, isAdmin: true, reason: "" }).ok).toBe(false);
    expect(dateAllowed({ issueDay: "2026-06-14", today: TODAY, isAdmin: true, reason: "missed from the June register" }))
      .toEqual({ ok: true });
  });
});

describe("which pump it came out of", () => {
  const badalgama = { name: "Badalgama Tank", balance: 7855.9, fuelKind: "AUTO_DIESEL" };

  it("takes the litres off the named pump", () => {
    expect(tankAllowed({ tank: badalgama, litres: 60, fuelKind: "AUTO_DIESEL" }))
      .toEqual({ ok: true, balanceAfter: 7795.9, source: "Badalgama Tank" });
  });

  it("names the pump as the source, as the operator consoles do", () => {
    const r = tankAllowed({ tank: badalgama, litres: 60, fuelKind: "AUTO_DIESEL" });
    expect(r).toMatchObject({ source: "Badalgama Tank" });
  });

  it("allows a station purchase with no tank behind it", () => {
    expect(tankAllowed({ tank: null, litres: 60, fuelKind: "AUTO_DIESEL" }))
      .toEqual({ ok: true, balanceAfter: null, source: null });
  });

  it("refuses to draw more than the pump holds", () => {
    expect(tankAllowed({ tank: { ...badalgama, balance: 40 }, litres: 60, fuelKind: "AUTO_DIESEL" }))
      .toEqual({ ok: false, error: "not enough in the tank" });
  });

  it("refuses to take petrol out of a diesel tank", () => {
    expect(tankAllowed({ tank: badalgama, litres: 60, fuelKind: "PETROL_92" }))
      .toEqual({ ok: false, error: "wrong product" });
  });

  it("allows the pump to be emptied exactly", () => {
    expect(tankAllowed({ tank: { ...badalgama, balance: 60 }, litres: 60, fuelKind: "AUTO_DIESEL" }))
      .toMatchObject({ ok: true, balanceAfter: 0 });
  });
});
