// Default service-sheet master data, merged from the standalone Service Record
// system (see service-record/db.js). Pure constants only — safe to import from
// both app code (`@/lib/service/defaults`) and the Prisma seed.

export interface OilTypeSeed {
  name: string;
  unit: string;
}

// The oil lines that make up the oils matrix on a service sheet.
export const DEFAULT_OILS: OilTypeSeed[] = [
  { name: "Engine Oil", unit: "L" },
  { name: "Gear Box Oil", unit: "L" },
  { name: "Differential Oil", unit: "L" },
  { name: "Transmission Oil", unit: "L" },
  { name: "Hydraulic Oil", unit: "L" },
  { name: "Torque Con. Oil", unit: "L" },
  { name: "Power Steering Oil", unit: "L" },
  { name: "Brake Oil", unit: "L" },
  { name: "Swing Motor Oil", unit: "L" },
  { name: "Travelling Motor Oil", unit: "L" },
  { name: "Rear Axel Case Oil", unit: "L" },
  { name: "Front Axel Case Oil", unit: "L" },
  { name: "Circle Gear Case Oil", unit: "L" },
  { name: "Tandem Drive Oil", unit: "L" },
  { name: "Compressor Oil", unit: "L" },
  { name: "Petrol & Kerosene Oil", unit: "L" },
  { name: "Grease", unit: "kg" },
  { name: "Battery water", unit: "L" },
  { name: "Coolant", unit: "L" },
];

// The filter lines that make up the filters matrix on a service sheet.
export const DEFAULT_FILTER_CATEGORIES: string[] = [
  "Engine Oil Filter",
  "Air Filter",
  "Air Filter Inner",
  "Air Filter Outer",
  "Trans: Filter",
  "Water Separator",
  "Fuel Sedimentary",
  "Hydraulic Filter - S",
  "Line Filter",
  "Coolant Filter",
  "Power Steering Filter",
  "Air Dryer Filter",
  "Air Breather Filter",
  "Fuel Tank Filter",
  "Primary Fuel Filter",
  "Engine fuel Filter - S",
  "Engine Oil Filter - S",
  "Engine Air Filter - S",
];

// Labour / sundry charge rates. Stored in the key/value `Setting` table so an
// admin can edit them later; these are the seed/fallback values and mirror the
// Service Record system's defaults (20% / 15% split at Rs 10,000, sundry 5%).
export const SERVICE_SETTING_KEYS = {
  labourRateLow: "service.labourRateLow",
  labourRateHigh: "service.labourRateHigh",
  labourThresholdCents: "service.labourThresholdCents",
  sundryRate: "service.sundryRate",
} as const;

export const DEFAULT_SERVICE_RATES = {
  labourRateLow: 20, // % applied when parts subtotal <= threshold
  labourRateHigh: 15, // % applied when parts subtotal >  threshold
  labourThresholdCents: 1_000_000, // Rs 10,000 in cents
  sundryRate: 5, // % of parts subtotal
};

export type ServiceRates = typeof DEFAULT_SERVICE_RATES;
