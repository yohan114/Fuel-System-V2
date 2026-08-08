// The fixed rows of the paper "Vehicle/Machinery Service Details" sheet, so the
// digital lubricant catalogue and the service entry form line up with what the
// workshop already writes by hand.

// Left table — "Oil Name" rows.
export const OIL_SLOTS = [
  "Engine Oil",
  "Gear Box Oil",
  "Differential Oil",
  "Transmission Oil",
  "Hydraulic Oil",
  "Torque Con. Oil",
  "Power Steering Oil",
  "Brake Oil",
  "Swing Motor Oil",
  "Travelling Motor Oil",
  "Rear Axel Case Oil",
  "Front Axel Case Oil",
  "Circle Gear Case Oil",
  "Tandem Drive Oil",
  "Compressor Oil",
  "Petrol & Kerosene Oil",
  "Grease",
  "Battery water",
  "Coolant",
] as const;

// Right table — "Filters" rows.
export const FILTER_SLOTS = [
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
] as const;

// Oil line action: Change vs Topped-up (the "C/V" column).
export const OIL_ACTIONS = [
  { code: "C", label: "Change" },
  { code: "V", label: "Topped up" },
] as const;

// Filter line action: Replaced vs Cleaned (the "X/E" column).
export const FILTER_ACTIONS = [
  { code: "X", label: "Replaced" },
  { code: "E", label: "Cleaned" },
] as const;

// Up-keeping condition (Good / Fair / Bad).
export const CONDITIONS = [
  { code: "G", label: "Good" },
  { code: "F", label: "Fair" },
  { code: "B", label: "Bad" },
] as const;

export function conditionLabel(code: string | null | undefined): string {
  return CONDITIONS.find((c) => c.code === code)?.label ?? "—";
}
