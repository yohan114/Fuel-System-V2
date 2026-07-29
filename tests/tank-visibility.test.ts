import { describe, it, expect } from "vitest";
import { canSeeTankBalance, toTankView } from "../src/lib/tank-visibility";

const TANK = {
  id: "tank-1",
  name: "Badalgama Main Pump",
  fuelKind: "AUTO_DIESEL",
  balance: 4213.5,
  capacity: 10000,
};

const EMPTY = { ...TANK, id: "tank-2", name: "CEP-03 E Pump", balance: 0 };

describe("canSeeTankBalance", () => {
  it("admits only ADMIN", () => {
    expect(canSeeTankBalance("ADMIN")).toBe(true);
    for (const role of ["WORKSHOP", "SITE_PUMP", "USER", "ALLOCATOR", "", null, undefined]) {
      expect(canSeeTankBalance(role)).toBe(false);
    }
  });
});

describe("toTankView", () => {
  it("gives an admin the real litre figures", () => {
    const v = toTankView(TANK, "ADMIN");
    expect(v.balance).toBe(4213.5);
    expect(v.capacity).toBe(10000);
  });

  // The whole point of the control: a pump operator must not be able to read
  // the tank level, or they can size a fake issue to cover a physical shortfall.
  it("strips litre figures for every pump-operating role", () => {
    for (const role of ["WORKSHOP", "SITE_PUMP"]) {
      const v = toTankView(TANK, role);
      expect(v.balance).toBeNull();
      expect(v.capacity).toBeNull();
    }
  });

  it("strips litre figures for site users, allocators and unknown roles", () => {
    for (const role of ["USER", "ALLOCATOR", "SOMETHING_NEW", "", null, undefined]) {
      const v = toTankView(TANK, role);
      expect(v.balance).toBeNull();
      expect(v.capacity).toBeNull();
    }
  });

  it("never leaks a litre figure anywhere in a non-admin payload", () => {
    // Serialised form is what actually reaches the browser, so assert on that:
    // a value hidden only in the markup would still show up here.
    const serialised = JSON.stringify(toTankView(TANK, "WORKSHOP"));
    expect(serialised).not.toContain("4213");
    expect(serialised).not.toContain("10000");
  });

  it("still reports whether a tank holds fuel, so transfers stay usable", () => {
    expect(toTankView(TANK, "WORKSHOP").hasStock).toBe(true);
    expect(toTankView(EMPTY, "WORKSHOP").hasStock).toBe(false);
    // ...without disclosing the amount.
    expect(toTankView(TANK, "WORKSHOP").balance).toBeNull();
  });

  it("keeps the identifying fields every role needs", () => {
    const v = toTankView(TANK, "SITE_PUMP");
    expect(v.id).toBe("tank-1");
    expect(v.name).toBe("Badalgama Main Pump");
    expect(v.fuelKind).toBe("AUTO_DIESEL");
  });
});
