// The fuel products the system handles — tanks, issues, prices and reports all
// key on these codes. Labels follow Ceypetco product names; `ceypetcoMatch` is
// the keyword pattern used to find the product's column/row when fetching the
// published price table.

export interface FuelKindDef {
  code: string;
  label: string;
  short: string;
  ceypetcoMatch: RegExp;
}

// `ceypetcoMatch` accepts both wordings the published table has used: the full
// product names ("Lanka Auto Diesel") and the abbreviated headers Ceypetco
// switched to ("LAD", "LSD", "LP 92", "LP 95", "LK"). The abbreviations are
// anchored so "LK" (Lanka Kerosene) never swallows the neighbouring "LIK"
// (Lanka Industrial Kerosene) column, which is a different product.
export const FUEL_KINDS: FuelKindDef[] = [
  { code: "AUTO_DIESEL", label: "Lanka Auto Diesel", short: "Auto Diesel", ceypetcoMatch: /auto\s*diesel|^\s*lad\s*$/i },
  { code: "SUPER_DIESEL", label: "Lanka Super Diesel Euro 4", short: "Super Diesel", ceypetcoMatch: /super\s*diesel|^\s*lsd\s*$/i },
  { code: "PETROL_92", label: "Petrol 92 Octane", short: "Petrol 92", ceypetcoMatch: /petrol\s*(?:octane\s*)?92|92\s*(?:octane|unl)|^\s*lp\s*92\s*$/i },
  { code: "PETROL_95", label: "Petrol 95 Octane Euro 4", short: "Petrol 95", ceypetcoMatch: /petrol\s*(?:octane\s*)?95|95\s*(?:octane|unl)|^\s*lp\s*95\s*$/i },
  { code: "KEROSENE", label: "Lanka Kerosene", short: "Kerosene", ceypetcoMatch: /^\s*lk\s*$|kerosene/i },
];

export const FUEL_KIND_CODES = FUEL_KINDS.map((k) => k.code);

// Default capacity (litres) for a site's diesel tank. Used when a tank is
// auto-created alongside a new project, and as the default in the manual tank
// form. Always editable afterwards.
export const DEFAULT_TANK_CAPACITY = 15000;

export function isFuelKind(code: string | null | undefined): boolean {
  return !!code && FUEL_KIND_CODES.includes(code);
}

export function fuelKindLabel(code: string | null | undefined): string {
  return FUEL_KINDS.find((k) => k.code === code)?.short ?? code ?? "—";
}
