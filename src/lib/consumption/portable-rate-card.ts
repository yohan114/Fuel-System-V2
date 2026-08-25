// The 2026 portable equipment day-hire card.
//
// Portable plant is not priced like the rest of the fleet. It carries no meter
// anybody reads, so there are no hours and no kilometres to bill — it goes out
// for a day and comes back, and the card is a flat Rs/day at two tiers. That is
// why the rate card sheet has an "Hourly Rates" tab AND a separate "Portable
// Equipment Rates" tab: different unit, different tiers, different survey.
//
// Source: Fleet_Rental_Prices_2026_fuel_v10.xlsx, sheet "Portable Equipment
// Rates" — 59 capacity classes across 17 categories, surveyed against published
// Sri Lankan day-rates (Peters Equipment, Generators.lk, UTE, wedabima,
// surplus.lk), 2026. v10 added items 37–59 in August 2026; the 36 classes v9
// carried are unchanged, so no machine already priced from this card went stale.
//
// WET  = machine + fuel/power + operator + routine consumables.
// DRY  = bare machine hire only; the client fuels and mans it.
// Both exclude 18% VAT and transport.
//
// Two things v9 never had to express and v10 does:
//   * Minimum hire is no longer always one day — a builder's hoist is three,
//     scaffolding seven.
//   * Three items are non-powered (cube moulds, wheelbarrow, scaffolding), so
//     there is no fuel, power or operator to include and WET equals DRY. The
//     card's usual "wet is dearer" rule does not hold for them, and two of the
//     three are quoted per SET per day rather than per machine.
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
  /** What the rate buys: a machine for a day, or a set for a day. */
  billing: "Per day" | "Per set/day";
  /** Minimum billing quantum, as the sheet states it. */
  minimum: string;
  note: string;
  /** No fuel, power or operator to include, so wet and dry are the same rate. */
  nonPowered?: true;
}

interface CardRow {
  id: string;
  category: string;
  size: string;
  /** Rupees per day, as the sheet quotes them. */
  wet: number;
  dry: number;
  note: string;
  billing?: PortableClass["billing"];
  minimum?: string;
  nonPowered?: true;
}

// Almost every line is a machine for a day with a one-day minimum, so those are
// the defaults and only the exceptions are stated. That way the handful of rows
// that differ — the hoist, the scaffolding, the three non-powered items — stand
// out instead of hiding in fifty-nine repetitions of "Per day".
const K = (r: CardRow): PortableClass => ({
  id: r.id,
  category: r.category,
  size: r.size,
  wetCents: Math.round(r.wet * 100),
  dryCents: Math.round(r.dry * 100),
  billing: r.billing ?? "Per day",
  minimum: r.minimum ?? "1 day",
  note: r.note,
  ...(r.nonPowered ? { nonPowered: true as const } : {}),
});

// Grouped by category rather than kept in the sheet's numbering, so the table
// reads as a price list. The sheet's own item numbers are not carried: the one
// note that referenced another by number now names it instead.
export const PORTABLE_CLASSES: PortableClass[] = [
  K({ id: "generator/3-5kva", category: "Generator", size: "3–5 kVA (petrol, 1-ph)", wet: 5000, dry: 2500, note: "Peters Equipment: 5 kVA Rs.4,000 / 2–3 kVA Rs.5,000 per day" }),
  K({ id: "generator/10kva", category: "Generator", size: "10 kVA (diesel, 1-ph)", wet: 7000, dry: 3500, note: "Peters Equipment 10 kVA diesel Rs.6,000/day (op w/fuel basis)" }),
  K({ id: "generator/20-25kva", category: "Generator", size: "20–25 kVA (diesel, 3-ph)", wet: 12000, dry: 6000, note: "Peters Equipment 25 kVA diesel Rs.8,000/day" }),
  K({ id: "generator/30-50kva", category: "Generator", size: "30–50 kVA (diesel, 3-ph)", wet: 18000, dry: 10000, note: "Peters Equipment 50 kVA diesel Rs.10–12,000/day" }),
  K({ id: "generator/60-80kva", category: "Generator", size: "60–80 kVA (soundproof)", wet: 26000, dry: 15000, note: "Interpolated from the 50 kVA card + UTE/Generators.lk band" }),
  K({ id: "generator/100-125kva", category: "Generator", size: "100–125 kVA (soundproof)", wet: 38000, dry: 22000, note: "Generators.lk / UTE long-term construction band" }),
  K({ id: "generator/150kva", category: "Generator", size: "150 kVA (soundproof)", wet: 48000, dry: 28000, note: "Generators.lk 150 kVA upper rental band" }),

  K({ id: "compressor/2-3hp", category: "Air Compressor", size: "2–3 HP (portable, electric)", wet: 2200, dry: 1300, note: "SL hire-shop day-rate; surplus.lk “any capacity per day”" }),
  K({ id: "compressor/5-7hp", category: "Air Compressor", size: "5–7 HP (belt-drive, petrol)", wet: 3800, dry: 2400, note: "Competitive Western-Province hire-shop day-rate" }),
  K({ id: "compressor/10-15hp", category: "Air Compressor", size: "10–15 HP (industrial)", wet: 6500, dry: 4500, note: "Competitive Western-Province hire-shop day-rate" }),
  K({ id: "compressor/185cfm", category: "Air Compressor", size: "185 cfm (towable diesel)", wet: 16000, dry: 11000, note: "Towable jackhammer-feed compressor; project day-rate" }),
  K({ id: "compressor/375cfm", category: "Air Compressor", size: "375 cfm (towable diesel)", wet: 26000, dry: 18000, note: "Large towable diesel; project day-rate" }),

  K({ id: "poker/petrol", category: "Poker / Concrete Vibrator", size: "Petrol drive unit + shaft", wet: 2800, dry: 1700, note: "wedabima poker-machine listings; petrol drive day-hire" }),
  K({ id: "poker/electric", category: "Poker / Concrete Vibrator", size: "Electric drive unit + shaft", wet: 2000, dry: 1200, note: "Electric concrete vibrator day-hire" }),
  K({ id: "poker/needle", category: "Poker / Concrete Vibrator", size: "Needle/shaft only (35–60 mm)", wet: 800, dry: 500, note: "Accessory needle/shaft only" }),

  K({ id: "submersible/1in", category: "Submersible Pump", size: "1″ (dewatering, electric)", wet: 1300, dry: 800, note: "Dewatering day-hire; 1 HP class" }),
  K({ id: "submersible/2in", category: "Submersible Pump", size: "2″ (dewatering, electric)", wet: 2000, dry: 1300, note: "Dewatering day-hire; 2″ class" }),
  K({ id: "submersible/3in", category: "Submersible Pump", size: "3″ (dewatering, electric)", wet: 3000, dry: 2100, note: "Dewatering day-hire; 3″ class" }),
  K({ id: "submersible/4in", category: "Submersible Pump", size: "4″ (dewatering, electric)", wet: 4500, dry: 3300, note: "Dewatering day-hire; 4″ class" }),
  K({ id: "submersible/6in", category: "Submersible Pump", size: "6″ (high-volume)", wet: 8000, dry: 6000, note: "High-volume dewatering day-hire" }),

  K({ id: "waterpump/2in", category: "Engine Water Pump", size: "2″ (petrol, self-priming)", wet: 2800, dry: 1800, note: "Honda-type 2″ petrol pump day-hire" }),
  K({ id: "waterpump/3in", category: "Engine Water Pump", size: "3″ (petrol, self-priming)", wet: 3800, dry: 2600, note: "3″ petrol pump day-hire" }),
  K({ id: "waterpump/4in", category: "Engine Water Pump", size: "4″ (diesel)", wet: 6000, dry: 4300, note: "4″ diesel trash/water pump day-hire" }),
  K({ id: "waterpump/3in-trash", category: "Engine Water Pump", size: "3″ trash pump (solids-handling)", wet: 5200, dry: 3700, note: "Trash pump day-hire" }),

  K({ id: "hammer/sds-plus", category: "Rotary Hammer", size: "2–4 kg (SDS-plus)", wet: 1500, dry: 1000, note: "Peters Equipment Rotary Hammer SDS Rs.3,000/day (wet incl. bits/op). Under the published rate — worth reviewing before the next quotation round." }),
  K({ id: "hammer/sds-max", category: "Rotary Hammer", size: "5–7 kg (SDS-max)", wet: 2200, dry: 1500, note: "Heavier SDS-max class day-hire" }),
  K({ id: "hammer/breaker", category: "Rotary Hammer", size: "Demolition breaker 10–16 kg", wet: 4000, dry: 2700, note: "Peters Equipment Demolition Breaker Rs.4,000/day" }),
  K({ id: "hammer/jack-pneumatic", category: "Rotary Hammer", size: "Jack hammer, pneumatic (air-fed)", wet: 10000, dry: 6500, note: "Peters Equipment Jack Hammer Rs.10,000/day. Air-fed and cannot work alone — bill the 185 cfm towable compressor alongside it." }),

  K({ id: "saw/7in", category: "Circular Saw", size: "7″ (185 mm, hand-held)", wet: 1200, dry: 800, note: "Hand-held circular saw day-hire" }),
  K({ id: "saw/9in", category: "Circular Saw", size: "9″ (235 mm, hand-held)", wet: 1700, dry: 1100, note: "Larger hand-held circular saw day-hire" }),
  K({ id: "saw/14in-cutoff", category: "Circular Saw", size: "14″ cut-off / metal saw", wet: 3800, dry: 2600, note: "Abrasive cut-off saw day-hire" }),

  K({ id: "grinder/4-5in", category: "Angle Grinder", size: "4–5″ (100–125 mm)", wet: 900, dry: 550, note: "Small angle grinder day-hire" }),
  K({ id: "grinder/7-9in", category: "Angle Grinder", size: "7–9″ (180–230 mm)", wet: 1500, dry: 950, note: "Large angle grinder day-hire" }),

  K({ id: "tool/drill", category: "Power Tool — Other", size: "Hand / hammer / impact drill", wet: 700, dry: 450, note: "Peters Equipment hand/hammer drill Rs.250–500/day band" }),
  K({ id: "tool/plate-compactor", category: "Power Tool — Other", size: "Plate compactor (forward)", wet: 5000, dry: 3500, note: "Plate compactor day-hire" }),
  K({ id: "tool/power-trowel", category: "Power Tool — Other", size: "Power trowel (concrete)", wet: 5500, dry: 3800, note: "Power trowel day-hire. Peters Equipment publish Rs.10,000/day — this line sits below the market and is worth reviewing." }),
  K({ id: "tool/tamping-rammer", category: "Power Tool — Other", size: "Tamping rammer (jumping jack)", wet: 3500, dry: 2400, note: "Peters Equipment Tamping Rammer Rs.3,500/day" }),
  K({ id: "tool/vibrating-screed", category: "Power Tool — Other", size: "Vibrating screed (2–4 m beam, petrol)", wet: 5000, dry: 3400, note: "Screed-board day-hire; used with the power trowel on slab pours" }),
  K({ id: "tool/pressure-washer", category: "Power Tool — Other", size: "High-pressure washer (150–200 bar)", wet: 4500, dry: 3000, note: "Peters Equipment pressure-washer range; plant wash-down and formwork cleaning" }),

  K({ id: "welding/300a-diesel", category: "Welding Plant", size: "300 A diesel (engine-driven)", wet: 9500, dry: 6500, note: "Engine-driven welder day-hire" }),

  // ── added in v10, August 2026 ─────────────────────────────────────────────
  // Sizing follows the Sri Lankan "bag" convention: one bag is one 50 kg cement
  // bag per batch. A 1-bag tilting drum is about 200 L and yields roughly
  // 0.14 m³ per batch; a 2-bag machine about 400 L and 0.28 m³.
  K({ id: "mixer/pot-half-bag", category: "Concrete Mixer", size: "Pot (“poty”) mixer — ½ bag (~100 L, electric)", wet: 1800, dry: 1200, note: "Peters Equipment Poty Mixer Rs.1,500/day, bare hire. The small type used for plaster and small pours." }),
  K({ id: "mixer/1bag-electric", category: "Concrete Mixer", size: "1 bag tilting drum (200 L / 7 cu ft, electric)", wet: 3200, dry: 2200, note: "Peters Equipment Concrete Mixer Rs.3,000/day — the standard site machine" }),
  K({ id: "mixer/1bag-diesel", category: "Concrete Mixer", size: "1 bag tilting drum (200 L, diesel engine)", wet: 4200, dry: 2800, note: "Diesel drive premium over the electric machine; for sites without mains power" }),
  K({ id: "mixer/1.5bag", category: "Concrete Mixer", size: "1½ bag drum (300 L / 10 cu ft)", wet: 4800, dry: 3200, note: "Interpolated between the published 1-bag and the 2-bag market rate" }),
  K({ id: "mixer/2bag", category: "Concrete Mixer", size: "2 bag drum (400 L / 14 cu ft, diesel)", wet: 6500, dry: 4500, note: "Twice the batch output of the 1-bag machine; Western-Province hire-shop day-rate" }),
  K({ id: "mixer/2bag-hopper", category: "Concrete Mixer", size: "2 bag with hopper & lift (400–500 L, diesel)", wet: 9000, dry: 6200, note: "Mechanical hopper feed — cuts loading labour; premium over the plain 2-bag drum" }),

  K({ id: "concretesaw/diamond-floor", category: "Concrete Saw", size: "Diamond floor saw (walk-behind, petrol)", wet: 10000, dry: 7000, note: "Peters Equipment Concrete Saw Diamond Cutter Rs.10,000/day; blades charged separately at cost" }),
  K({ id: "concretesaw/asphalt-cutter", category: "Concrete Saw", size: "Asphalt cutter (walk-behind, petrol)", wet: 10000, dry: 7000, note: "Peters Equipment Concrete Saw Asphalt Cutter Rs.10,000/day; blades charged separately at cost" }),
  K({ id: "concretesaw/core-drill", category: "Concrete Saw", size: "Core drilling machine (up to 150 mm)", wet: 7500, dry: 5000, note: "Core-drill day-hire; core bits charged separately by diameter" }),

  K({ id: "barbend/bending-32mm", category: "Bar Bending / Cutting", size: "Bar bending machine (up to 32 mm)", wet: 6000, dry: 4200, note: "wedabima.com bar-bending machine hire; Western-Province day-rate" }),
  K({ id: "barbend/cutting-32mm", category: "Bar Bending / Cutting", size: "Bar cutting machine (up to 32 mm)", wet: 5500, dry: 3800, note: "wedabima.com rebar-cutter hire; Western-Province day-rate" }),

  K({ id: "hoist/500kg", category: "Material Hoist", size: "Builder's hoist / winch — 500 kg (electric)", wet: 9000, dry: 6000, minimum: "3 days", note: "wedabima.com hoist machine for hire; rate includes rigging, excludes tower erection" }),

  K({ id: "tilecutter/manual", category: "Tile Cutter", size: "Manual tile cutter (600–900 mm)", wet: 900, dry: 600, note: "Peters Equipment Manual Tile Cutter, day-hire" }),
  K({ id: "tilecutter/electric-wet", category: "Tile Cutter", size: "Electric wet tile saw", wet: 2500, dry: 1700, note: "Peters Equipment Electric Tile Cutter, day-hire" }),

  K({ id: "survey/auto-level", category: "Survey Instrument", size: "Auto level + tripod & staff", wet: 4000, dry: 2800, note: "wedabima.com level-instrument hire; set includes tripod and levelling staff" }),
  K({ id: "survey/rotary-laser", category: "Survey Instrument", size: "Rotary laser level + receiver", wet: 6500, dry: 4500, note: "wedabima.com laser level machine rental, Rajagiriya listing" }),

  // Non-powered: nothing to fuel, power or man, so wet equals dry.
  K({ id: "accessory/cube-moulds", category: "Site Accessory", size: "Steel cube moulds 150 mm (set of 6)", wet: 900, dry: 900, billing: "Per set/day", nonPowered: true, note: "Peters Equipment Steel Moulds. Non-powered — wet equals dry." }),
  K({ id: "accessory/wheelbarrow", category: "Site Accessory", size: "Concrete wheelbarrow", wet: 400, dry: 400, nonPowered: true, note: "Peters Equipment Concrete Wheel Barrow. Non-powered — wet equals dry." }),
  K({ id: "accessory/scaffolding", category: "Site Accessory", size: "Scaffolding frame set + acro jacks", wet: 1200, dry: 1200, billing: "Per set/day", minimum: "7 days", nonPowered: true, note: "wedabima.com scaffolding & acro-jack hire. Non-powered — wet equals dry. Normally quoted per set per month; this per-day rate is for short site hire only." }),
];

export const PORTABLE_CARD_SOURCE =
  "Fleet_Rental_Prices_2026_fuel_v10.xlsx · “Portable Equipment Rates” · 59 classes, 17 categories · items 37–59 added Aug 2026";

const BY_ID = new Map(PORTABLE_CLASSES.map((k) => [k.id, k]));
export const portableClassById = (id: string): PortableClass | null => BY_ID.get(id) ?? null;

/** The card's own categories, in sheet order, for grouping the table. */
export const PORTABLE_CATEGORIES: string[] = [...new Set(PORTABLE_CLASSES.map((k) => k.category))];

// Machines that read as portable plant but are not. A truck mixer is a road
// vehicle billed by the kilometre — there are 19 of them, and "mixer" now
// matches a card category, so without this the fleet's concrete trucks would be
// offered a Rs 3,200/day site-mixer rate. Checked before anything else, and it
// returns "not portable at all" rather than falling through to the next rule.
const NOT_PORTABLE = /truck\s*mixer|transit\s*mixer|self\s*load(er|ing)?\s*mixer|mixer\s*truck|bowser|prime\s*mover/i;

// Which card category a machine belongs to, read off whatever the fleet
// register happens to call it. The register is inconsistent — "Compreshor",
// "Genarator", "Ganaretor", "Welding Gene", "C. Mixcher", "CONCREETE MIXER" all
// appear — so this matches on substrings rather than expecting a tidy value,
// and returns null rather than guessing when nothing fits.
//
// ORDER IS LOAD-BEARING. Every specific rule must precede the general one it
// would otherwise be swallowed by: core drilling is a Concrete Saw and must
// beat "drill"; a tile cutter and a bar cutter must both beat any saw rule; a
// welding generator is a welding plant, not a generator.
const CATEGORY_HINTS: [RegExp, string][] = [
  [/weld/i, "Welding Plant"],
  [/gen[ae]?r?[ae]t|genarator|ganaretor/i, "Generator"],
  [/compr[ae]?s|composer|compess/i, "Air Compressor"],
  [/submersible/i, "Submersible Pump"],
  [/water\s*pump|engine\s*pump|trash\s*pump/i, "Engine Water Pump"],

  // v10 categories. These sit above the older general rules on purpose.
  [/concrete\s*saw|floor\s*saw|asphalt\s*cut|core\s*drill|diamond\s*cut/i, "Concrete Saw"],
  [/tile/i, "Tile Cutter"],
  [/bar\s*bend|bar\s*cut|rebar|bending\s*machine/i, "Bar Bending / Cutting"],
  [/hoist|winch/i, "Material Hoist"],
  [/auto\s*level|laser\s*level|level\s*instrument|dumpy|theodolite|total\s*station/i, "Survey Instrument"],
  [/mou?ld|wheel\s*barrow|wheelbarrow|scaffold|acro\s*jack/i, "Site Accessory"],
  [/rammer|jumping\s*jack|screed|pressure\s*wash/i, "Power Tool — Other"],
  [/mix(er|cher)|poty|poti/i, "Concrete Mixer"],

  [/poker|vibrator/i, "Poker / Concrete Vibrator"],
  [/breaker|rotary\s*hammer|jack\s*hammer|hammer/i, "Rotary Hammer"],
  [/circular\s*saw|cut-?off/i, "Circular Saw"],
  [/grinder/i, "Angle Grinder"],
  [/trowel|plate\s*compactor|drill/i, "Power Tool — Other"],
];

export function guessCardCategory(...labels: (string | null | undefined)[]): string | null {
  const text = labels.filter(Boolean).join(" ");
  if (!text.trim()) return null;
  if (NOT_PORTABLE.test(text)) return null;
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return null;
}

// The fleet code carries the class when the labels do not. GE-105 and GE-62
// have no type label at all, and the register files WG- welding sets under
// "Other Asset", so the prefix is the only thing left to read.
// TM- is deliberately absent: those are truck mixers, not site mixers.
const CODE_PREFIX: [RegExp, string][] = [
  [/^WG[-\s]/i, "Welding Plant"],
  [/^GE[-\s]/i, "Generator"],
  [/^ACS?[-\s]/i, "Air Compressor"],
  [/^CM[-\s]/i, "Concrete Mixer"],
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
