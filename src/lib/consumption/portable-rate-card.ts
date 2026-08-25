// The 2026 portable equipment day-hire card.
//
// Portable plant is not priced like the rest of the fleet. It carries no meter
// anybody reads, so there are no hours and no kilometres to bill — it goes out
// for a day and comes back, and the card is a flat Rs/day at two tiers. That is
// why the rate card sheet has an "Hourly Rates" tab AND a separate "Portable
// Equipment Rates" tab: different unit, different tiers, different survey.
//
// Source: Fleet_Rental_Prices_2026_fuel_v9.xlsx, sheet "Portable Equipment
// Rates" — 36 capacity classes surveyed against published Sri Lankan day-rates
// (Peters Equipment, Generators.lk, UTE, wedabima, surplus.lk), May–Jun 2026.
//
// WET  = machine + fuel/power + operator + routine consumables.
// DRY  = bare machine hire only; the client fuels and mans it.
// Both exclude 18% VAT and transport. Minimum billing is one day.
//
// This lives in code rather than a table because it is a published price list,
// not fleet state: it is versioned with the workbook it came from, and a machine
// gets its own copy of the figures the moment a class is applied to it. Editing
// a machine's rate afterwards is a per-machine decision and belongs on the
// machine, which is where the rates screen already puts it.

export interface PortableClass {
  /** Stable key: category slug + size slug. Written into the audit trail. */
  id: string;
  category: string;
  size: string;
  wetCents: number;
  dryCents: number;
  /** Minimum billing quantum, as the sheet states it. */
  minimum: string;
  note: string;
}

const c = (rupees: number) => rupees * 100;

export const PORTABLE_CLASSES: PortableClass[] = [
  { id: "generator/3-5kva", category: "Generator", size: "3–5 kVA (petrol, 1-ph)", wetCents: c(5000), dryCents: c(2500), minimum: "1 day", note: "Peters Equipment: 5 kVA Rs.4,000 / 2–3 kVA Rs.5,000 per day" },
  { id: "generator/10kva", category: "Generator", size: "10 kVA (diesel, 1-ph)", wetCents: c(7000), dryCents: c(3500), minimum: "1 day", note: "Peters Equipment 10 kVA diesel Rs.6,000/day (op w/fuel basis)" },
  { id: "generator/20-25kva", category: "Generator", size: "20–25 kVA (diesel, 3-ph)", wetCents: c(12000), dryCents: c(6000), minimum: "1 day", note: "Peters Equipment 25 kVA diesel Rs.8,000/day" },
  { id: "generator/30-50kva", category: "Generator", size: "30–50 kVA (diesel, 3-ph)", wetCents: c(18000), dryCents: c(10000), minimum: "1 day", note: "Peters Equipment 50 kVA diesel Rs.10–12,000/day" },
  { id: "generator/60-80kva", category: "Generator", size: "60–80 kVA (soundproof)", wetCents: c(26000), dryCents: c(15000), minimum: "1 day", note: "Interpolated from the 50 kVA card + UTE/Generators.lk band" },
  { id: "generator/100-125kva", category: "Generator", size: "100–125 kVA (soundproof)", wetCents: c(38000), dryCents: c(22000), minimum: "1 day", note: "Generators.lk / UTE long-term construction band" },
  { id: "generator/150kva", category: "Generator", size: "150 kVA (soundproof)", wetCents: c(48000), dryCents: c(28000), minimum: "1 day", note: "Generators.lk 150 kVA upper rental band" },

  { id: "compressor/2-3hp", category: "Air Compressor", size: "2–3 HP (portable, electric)", wetCents: c(2200), dryCents: c(1300), minimum: "1 day", note: "SL hire-shop day-rate; surplus.lk “any capacity per day”" },
  { id: "compressor/5-7hp", category: "Air Compressor", size: "5–7 HP (belt-drive, petrol)", wetCents: c(3800), dryCents: c(2400), minimum: "1 day", note: "Competitive Western-Province hire-shop day-rate" },
  { id: "compressor/10-15hp", category: "Air Compressor", size: "10–15 HP (industrial)", wetCents: c(6500), dryCents: c(4500), minimum: "1 day", note: "Competitive Western-Province hire-shop day-rate" },
  { id: "compressor/185cfm", category: "Air Compressor", size: "185 cfm (towable diesel)", wetCents: c(16000), dryCents: c(11000), minimum: "1 day", note: "Towable jackhammer-feed compressor; project day-rate" },
  { id: "compressor/375cfm", category: "Air Compressor", size: "375 cfm (towable diesel)", wetCents: c(26000), dryCents: c(18000), minimum: "1 day", note: "Large towable diesel; project day-rate" },

  { id: "poker/petrol", category: "Poker / Concrete Vibrator", size: "Petrol drive unit + shaft", wetCents: c(2800), dryCents: c(1700), minimum: "1 day", note: "wedabima poker-machine listings; petrol drive day-hire" },
  { id: "poker/electric", category: "Poker / Concrete Vibrator", size: "Electric drive unit + shaft", wetCents: c(2000), dryCents: c(1200), minimum: "1 day", note: "Electric concrete vibrator day-hire" },
  { id: "poker/needle", category: "Poker / Concrete Vibrator", size: "Needle/shaft only (35–60 mm)", wetCents: c(800), dryCents: c(500), minimum: "1 day", note: "Accessory needle/shaft only" },

  { id: "submersible/1in", category: "Submersible Pump", size: "1″ (dewatering, electric)", wetCents: c(1300), dryCents: c(800), minimum: "1 day", note: "Dewatering day-hire; 1 HP class" },
  { id: "submersible/2in", category: "Submersible Pump", size: "2″ (dewatering, electric)", wetCents: c(2000), dryCents: c(1300), minimum: "1 day", note: "Dewatering day-hire; 2″ class" },
  { id: "submersible/3in", category: "Submersible Pump", size: "3″ (dewatering, electric)", wetCents: c(3000), dryCents: c(2100), minimum: "1 day", note: "Dewatering day-hire; 3″ class" },
  { id: "submersible/4in", category: "Submersible Pump", size: "4″ (dewatering, electric)", wetCents: c(4500), dryCents: c(3300), minimum: "1 day", note: "Dewatering day-hire; 4″ class" },
  { id: "submersible/6in", category: "Submersible Pump", size: "6″ (high-volume)", wetCents: c(8000), dryCents: c(6000), minimum: "1 day", note: "High-volume dewatering day-hire" },

  { id: "waterpump/2in", category: "Engine Water Pump", size: "2″ (petrol, self-priming)", wetCents: c(2800), dryCents: c(1800), minimum: "1 day", note: "Honda-type 2″ petrol pump day-hire" },
  { id: "waterpump/3in", category: "Engine Water Pump", size: "3″ (petrol, self-priming)", wetCents: c(3800), dryCents: c(2600), minimum: "1 day", note: "3″ petrol pump day-hire" },
  { id: "waterpump/4in", category: "Engine Water Pump", size: "4″ (diesel)", wetCents: c(6000), dryCents: c(4300), minimum: "1 day", note: "4″ diesel trash/water pump day-hire" },
  { id: "waterpump/3in-trash", category: "Engine Water Pump", size: "3″ trash pump (solids-handling)", wetCents: c(5200), dryCents: c(3700), minimum: "1 day", note: "Trash pump day-hire" },

  { id: "hammer/sds-plus", category: "Rotary Hammer", size: "2–4 kg (SDS-plus)", wetCents: c(1500), dryCents: c(1000), minimum: "1 day", note: "Peters Equipment Rotary Hammer SDS Rs.3,000/day (wet incl. bits/op)" },
  { id: "hammer/sds-max", category: "Rotary Hammer", size: "5–7 kg (SDS-max)", wetCents: c(2200), dryCents: c(1500), minimum: "1 day", note: "Heavier SDS-max class day-hire" },
  { id: "hammer/breaker", category: "Rotary Hammer", size: "Demolition breaker 10–16 kg", wetCents: c(4000), dryCents: c(2700), minimum: "1 day", note: "Peters Equipment Demolition Breaker Rs.4,000/day" },

  { id: "saw/7in", category: "Circular Saw", size: "7″ (185 mm, hand-held)", wetCents: c(1200), dryCents: c(800), minimum: "1 day", note: "Hand-held circular saw day-hire" },
  { id: "saw/9in", category: "Circular Saw", size: "9″ (235 mm, hand-held)", wetCents: c(1700), dryCents: c(1100), minimum: "1 day", note: "Larger hand-held circular saw day-hire" },
  { id: "saw/14in-cutoff", category: "Circular Saw", size: "14″ cut-off / metal saw", wetCents: c(3800), dryCents: c(2600), minimum: "1 day", note: "Abrasive cut-off saw day-hire" },

  { id: "grinder/4-5in", category: "Angle Grinder", size: "4–5″ (100–125 mm)", wetCents: c(900), dryCents: c(550), minimum: "1 day", note: "Small angle grinder day-hire" },
  { id: "grinder/7-9in", category: "Angle Grinder", size: "7–9″ (180–230 mm)", wetCents: c(1500), dryCents: c(950), minimum: "1 day", note: "Large angle grinder day-hire" },

  { id: "tool/drill", category: "Power Tool — Other", size: "Hand / hammer / impact drill", wetCents: c(700), dryCents: c(450), minimum: "1 day", note: "Peters Equipment hand/hammer drill Rs.250–500/day band" },
  { id: "tool/plate-compactor", category: "Power Tool — Other", size: "Plate compactor (forward)", wetCents: c(5000), dryCents: c(3500), minimum: "1 day", note: "Plate compactor day-hire (cf. Tamping Rammer Rs.3,500)" },
  { id: "tool/power-trowel", category: "Power Tool — Other", size: "Power trowel (concrete)", wetCents: c(5500), dryCents: c(3800), minimum: "1 day", note: "Power trowel day-hire" },

  { id: "welding/300a-diesel", category: "Welding Plant", size: "300 A diesel (engine-driven)", wetCents: c(9500), dryCents: c(6500), minimum: "1 day", note: "Engine-driven welder day-hire" },
];

export const PORTABLE_CARD_SOURCE =
  "Fleet_Rental_Prices_2026_fuel_v9.xlsx · “Portable Equipment Rates” · surveyed May–Jun 2026";

const BY_ID = new Map(PORTABLE_CLASSES.map((k) => [k.id, k]));
export const portableClassById = (id: string): PortableClass | null => BY_ID.get(id) ?? null;

/** The card's own categories, in sheet order, for grouping the table. */
export const PORTABLE_CATEGORIES: string[] = [...new Set(PORTABLE_CLASSES.map((k) => k.category))];

// Which card category a machine belongs to, read off whatever the fleet
// register happens to call it. The register is inconsistent — "Compreshor",
// "Genarator", "Ganaretor", "Welding Gene" all appear — so this matches on
// substrings rather than expecting a tidy value, and returns null rather than
// guessing when nothing fits.
const CATEGORY_HINTS: [RegExp, string][] = [
  [/weld/i, "Welding Plant"],
  [/gen[ae]?r?[ae]t|genarator|ganaretor/i, "Generator"],
  [/compr[ae]?s|composer|compess/i, "Air Compressor"],
  [/submersible/i, "Submersible Pump"],
  [/water\s*pump|engine\s*pump|trash\s*pump/i, "Engine Water Pump"],
  [/poker|vibrator/i, "Poker / Concrete Vibrator"],
  [/breaker|rotary\s*hammer|hammer/i, "Rotary Hammer"],
  [/circular\s*saw|cut-?off/i, "Circular Saw"],
  [/grinder/i, "Angle Grinder"],
  [/trowel|plate\s*compactor|drill/i, "Power Tool — Other"],
];

export function guessCardCategory(...labels: (string | null | undefined)[]): string | null {
  const text = labels.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  // A welding generator is a welding plant, not a generator, so the welding
  // rule is tested first and wins outright.
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return null;
}

// The fleet code carries the class when the labels do not. GE-105 and GE-62
// have no type label at all, and the register files WG- welding sets under
// "Other Asset", so the prefix is the only thing left to read.
const CODE_PREFIX: [RegExp, string][] = [
  [/^WG[-\s]/i, "Welding Plant"],
  [/^GE[-\s]/i, "Generator"],
  [/^ACS?[-\s]/i, "Air Compressor"],
];

export function cardCategoryForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  for (const [re, cat] of CODE_PREFIX) if (re.test(code)) return cat;
  return null;
}

export type PortableMatch =
  | { kind: "exact"; cls: PortableClass }
  | { kind: "dry-only"; cls: PortableClass }
  | { kind: "wet-only"; cls: PortableClass }
  | { kind: "off-card" }
  | { kind: "unpriced" };

/**
 * Which card class a machine's current rates sit on.
 *
 * The category hint matters: Rs 6,000/day dry is both a 20–25 kVA generator and
 * a 6-inch submersible pump. Matching on the figure alone would put a generator
 * on a pump's class and quietly hand it the pump's wet rate.
 */
export function matchPortableClass(
  wetCents: number | null,
  dryCents: number | null,
  categoryHint: string | null,
): PortableMatch {
  if (wetCents == null && dryCents == null) return { kind: "unpriced" };
  const pool = categoryHint
    ? PORTABLE_CLASSES.filter((k) => k.category === categoryHint)
    : PORTABLE_CLASSES;

  const both = pool.find((k) => k.wetCents === wetCents && k.dryCents === dryCents);
  if (both) return { kind: "exact", cls: both };

  if (wetCents == null && dryCents != null) {
    const hits = pool.filter((k) => k.dryCents === dryCents);
    if (hits.length === 1) return { kind: "dry-only", cls: hits[0] };
  }
  if (dryCents == null && wetCents != null) {
    const hits = pool.filter((k) => k.wetCents === wetCents);
    if (hits.length === 1) return { kind: "wet-only", cls: hits[0] };
  }
  return { kind: "off-card" };
}

export const MATCH_LABEL: Record<PortableMatch["kind"], string> = {
  exact: "on the card",
  "dry-only": "dry rate only — no wet rate",
  "wet-only": "wet rate only — no dry rate",
  "off-card": "off card",
  unpriced: "no rate at all",
};
