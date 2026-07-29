// Bulk-tank stock figures are ADMIN-only.
//
// A pump operator who can read the tank level is able to size a fake fuel issue
// so the book still balances after fuel has been physically siphoned off — the
// tank total is the thief's feedback signal. With the figure hidden, a fake
// entry shows up as a shortfall against the physical dip at /admin/tanks
// instead of quietly hiding one.
//
// The numbers are stripped on the server rather than hidden in the UI: a value
// merely omitted from the markup still travels inside the rendered page
// payload, where View Source would expose it.

export interface TankView {
  id: string;
  name: string;
  fuelKind: string;
  /** Litres remaining — null for every role except ADMIN. */
  balance: number | null;
  /** Tank capacity in litres — null for every role except ADMIN. */
  capacity: number | null;
  /**
   * Whether the tank holds any fuel. Lets the inter-site transfer picker list
   * usable source tanks without disclosing how much each one holds.
   */
  hasStock: boolean;
}

interface TankRecord {
  id: string;
  name: string;
  fuelKind: string;
  balance: number;
  capacity: number;
}

/** Only administrators may see litre figures for a bulk tank. */
export function canSeeTankBalance(role: string | null | undefined): boolean {
  return role === "ADMIN";
}

/** Strips litre figures from a tank record unless the viewer is an admin. */
export function toTankView(tank: TankRecord, role: string | null | undefined): TankView {
  const showBalance = canSeeTankBalance(role);
  return {
    id: tank.id,
    name: tank.name,
    fuelKind: tank.fuelKind,
    balance: showBalance ? tank.balance : null,
    capacity: showBalance ? tank.capacity : null,
    hasStock: tank.balance > 0,
  };
}
