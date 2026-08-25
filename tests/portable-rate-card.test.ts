import { describe, it, expect } from "vitest";
import {
  PORTABLE_CLASSES,
  PORTABLE_CATEGORIES,
  portableClassById,
  guessCardCategory,
  cardCategoryForCode,
  matchPortableClass,
} from "../src/lib/consumption/portable-rate-card";

describe("the portable day-hire card", () => {
  it("carries all 59 classes from the v10 workbook sheet", () => {
    expect(PORTABLE_CLASSES).toHaveLength(59);
  });

  it("gives every class a unique id", () => {
    expect(new Set(PORTABLE_CLASSES.map((k) => k.id)).size).toBe(59);
  });

  it("prices wet above dry, except where there is nothing to include", () => {
    // v10 added three non-powered lines — cube moulds, a wheelbarrow and
    // scaffolding. No fuel, no power, no operator, so wet equals dry. Every
    // other line still has to charge more for a wet hire.
    for (const k of PORTABLE_CLASSES) {
      if (k.nonPowered) expect(k.wetCents, k.id).toBe(k.dryCents);
      else expect(k.wetCents, k.id).toBeGreaterThan(k.dryCents);
    }
    expect(PORTABLE_CLASSES.filter((k) => k.nonPowered).map((k) => k.id)).toEqual([
      "accessory/cube-moulds", "accessory/wheelbarrow", "accessory/scaffolding",
    ]);
  });

  it("carries the billing quantum and minimum hire, which are no longer uniform", () => {
    // v9 was "Per day / 1 day" throughout, so neither was worth stating. v10
    // quotes two items per SET per day, and a hoist for three days minimum.
    expect(portableClassById("hoist/500kg")).toMatchObject({ billing: "Per day", minimum: "3 days" });
    expect(portableClassById("accessory/scaffolding")).toMatchObject({ billing: "Per set/day", minimum: "7 days" });
    expect(portableClassById("accessory/cube-moulds")).toMatchObject({ billing: "Per set/day", minimum: "1 day" });
    // Everything else keeps the default.
    expect(portableClassById("generator/10kva")).toMatchObject({ billing: "Per day", minimum: "1 day" });
    expect(new Set(PORTABLE_CLASSES.map((k) => k.minimum))).toEqual(new Set(["1 day", "3 days", "7 days"]));
  });

  it("kept every v9 class at its v9 price — the update was purely additive", () => {
    // If any of these moved, machines already priced from the card went stale
    // without anybody being told.
    expect(portableClassById("generator/20-25kva")).toMatchObject({ wetCents: 1_200_000, dryCents: 600_000 });
    expect(portableClassById("compressor/185cfm")).toMatchObject({ wetCents: 1_600_000, dryCents: 1_100_000 });
    expect(portableClassById("welding/300a-diesel")).toMatchObject({ wetCents: 950_000, dryCents: 650_000 });
    expect(portableClassById("waterpump/3in")).toMatchObject({ wetCents: 380_000, dryCents: 260_000 });
    expect(portableClassById("compressor/10-15hp")).toMatchObject({ wetCents: 650_000, dryCents: 450_000 });
    expect(portableClassById("generator/10kva")).toMatchObject({ wetCents: 700_000, dryCents: 350_000 });
  });

  it("prices the v10 additions as the sheet states them", () => {
    expect(portableClassById("mixer/1bag-electric")).toMatchObject({ wetCents: 320_000, dryCents: 220_000 });
    expect(portableClassById("mixer/2bag-hopper")).toMatchObject({ wetCents: 900_000, dryCents: 620_000 });
    expect(portableClassById("concretesaw/diamond-floor")).toMatchObject({ wetCents: 1_000_000, dryCents: 700_000 });
    expect(portableClassById("hammer/jack-pneumatic")).toMatchObject({ wetCents: 1_000_000, dryCents: 650_000 });
    expect(portableClassById("tool/tamping-rammer")).toMatchObject({ wetCents: 350_000, dryCents: 240_000 });
    expect(portableClassById("accessory/wheelbarrow")).toMatchObject({ wetCents: 40_000, dryCents: 40_000 });
  });

  it("holds figures in cents, matching the sheet's rupees", () => {
    expect(portableClassById("generator/20-25kva")).toMatchObject({ wetCents: 1_200_000, dryCents: 600_000 });
    expect(portableClassById("compressor/185cfm")).toMatchObject({ wetCents: 1_600_000, dryCents: 1_100_000 });
    expect(portableClassById("welding/300a-diesel")).toMatchObject({ wetCents: 950_000, dryCents: 650_000 });
  });

  it("returns null for an id that is not on the card", () => {
    expect(portableClassById("generator/999kva")).toBeNull();
  });

  it("groups into the sheet's seventeen categories", () => {
    expect(PORTABLE_CATEGORIES).toEqual([
      "Generator", "Air Compressor", "Poker / Concrete Vibrator", "Submersible Pump",
      "Engine Water Pump", "Rotary Hammer", "Circular Saw", "Angle Grinder",
      "Power Tool — Other", "Welding Plant",
      "Concrete Mixer", "Concrete Saw", "Bar Bending / Cutting", "Material Hoist",
      "Tile Cutter", "Survey Instrument", "Site Accessory",
    ]);
  });

  it("keeps each category's rows together so the card reads as a price list", () => {
    // The sheet interleaves the additions (a jack hammer at item 46, long after
    // the other hammers). Grouping is what makes the table usable.
    const seen = new Set<string>();
    let previous = "";
    for (const k of PORTABLE_CLASSES) {
      if (k.category !== previous) {
        expect(seen.has(k.category), `${k.category} appears in two separate blocks`).toBe(false);
        seen.add(k.category);
        previous = k.category;
      }
    }
  });
});

describe("reading a machine's class off the register", () => {
  it("copes with how the register actually spells things", () => {
    expect(guessCardCategory("Generator", "Genarator")).toBe("Generator");
    expect(guessCardCategory("Generator", "Ganaretor")).toBe("Generator");
    expect(guessCardCategory("Compressor", "Compreshor")).toBe("Air Compressor");
    expect(guessCardCategory("Compressor", "Air Composer")).toBe("Air Compressor");
  });

  it("calls a welding generator a welding plant, not a generator", () => {
    // Both words are present; the welding rule has to win or WG-13's Rs 9,500
    // welder gets matched against the generator column.
    expect(guessCardCategory("Other Asset", "Welding Generator")).toBe("Welding Plant");
    expect(guessCardCategory("Other Asset", "Welding Gene")).toBe("Welding Plant");
  });

  it("reads the machine code when the labels say nothing useful", () => {
    expect(guessCardCategory("Other Asset", "Other Asset", "WATER PUMP")).toBe("Engine Water Pump");
    expect(cardCategoryForCode("GE-105")).toBe("Generator");
    expect(cardCategoryForCode("WG-63")).toBe("Welding Plant");
    expect(cardCategoryForCode("AC-24")).toBe("Air Compressor");
    expect(cardCategoryForCode("ACS-02")).toBe("Air Compressor");
  });

  it("recognises the site concrete mixers v10 added a class for", () => {
    // The register spells this five different ways across seven machines.
    expect(guessCardCategory("Concrete Mixer (1-2 bag)", "C. Mixcher")).toBe("Concrete Mixer");
    expect(guessCardCategory("Concrete Mixer (1-2 bag)", "CONCREETE MIXER")).toBe("Concrete Mixer");
    expect(guessCardCategory("Other Asset", "Site equipment", "MIXER MACHINE")).toBe("Concrete Mixer");
    expect(guessCardCategory("Other Asset", null, "C-mixer")).toBe("Concrete Mixer");
    expect(cardCategoryForCode("CM-24")).toBe("Concrete Mixer");
  });

  it("refuses to treat a truck mixer as a site mixer", () => {
    // Nineteen truck mixers are in the register, billed by the kilometre. Once
    // "mixer" maps to a card category, matching one would offer a road vehicle
    // a Rs 3,200/day site-mixer rate.
    expect(guessCardCategory("Truck Mixer", "Truck Mixer")).toBeNull();
    expect(guessCardCategory("Truck Mixer", "Self Loader Mixer")).toBeNull();
    expect(guessCardCategory("Other Asset", "Truck Mixer", "ZB-0050")).toBeNull();
    expect(cardCategoryForCode("TM-01")).toBeNull();
    // Bowsers and prime movers are excluded for the same reason.
    expect(guessCardCategory("Water Bowser", "Water Bowser")).toBeNull();
  });

  it("reads the other categories v10 added", () => {
    expect(guessCardCategory("Other Asset", "Tamping Rammer", "RAMMER")).toBe("Power Tool — Other");
    expect(guessCardCategory("Other Asset", "Bar Bending Machine")).toBe("Bar Bending / Cutting");
    expect(guessCardCategory("Other Asset", "Builder's hoist")).toBe("Material Hoist");
    expect(guessCardCategory("Other Asset", "Auto Level")).toBe("Survey Instrument");
    expect(guessCardCategory("Other Asset", "Scaffolding frame")).toBe("Site Accessory");
    expect(guessCardCategory("Other Asset", "Concrete Wheelbarrow")).toBe("Site Accessory");
    expect(guessCardCategory("Other Asset", "Jack Hammer")).toBe("Rotary Hammer");
  });

  it("puts the specific rule ahead of the general one it would be swallowed by", () => {
    // Each of these matches an older, broader rule further down the list.
    expect(guessCardCategory("Core drilling machine")).toBe("Concrete Saw"); // not "drill"
    expect(guessCardCategory("Asphalt cutter")).toBe("Concrete Saw");
    expect(guessCardCategory("Manual tile cutter")).toBe("Tile Cutter");
    expect(guessCardCategory("Bar cutting machine")).toBe("Bar Bending / Cutting");
    expect(guessCardCategory("Vibrating screed")).toBe("Power Tool — Other"); // not "vibrator"
    expect(guessCardCategory("Welding Generator")).toBe("Welding Plant"); // not "generator"
  });

  it("admits when it does not know", () => {
    expect(guessCardCategory(null, undefined, "")).toBeNull();
    expect(guessCardCategory("Dump Truck", "Tipper")).toBeNull();
    expect(cardCategoryForCode(null)).toBeNull();
    expect(cardCategoryForCode("DT-73")).toBeNull();
  });
});

describe("matching a machine's rates to a class", () => {
  it("matches on both figures when both are set", () => {
    const m = matchPortableClass(700_000, 350_000, "Generator");
    expect(m).toEqual({ kind: "exact", cls: portableClassById("generator/10kva") });
  });

  it("matches a dry-only machine and names the class its wet rate is missing from", () => {
    const m = matchPortableClass(null, 600_000, "Generator");
    expect(m.kind).toBe("dry-only");
    expect("cls" in m && m.cls.id).toBe("generator/20-25kva");
  });

  it("will not put a generator on a pump's class because the dry figure agrees", () => {
    // Rs 6,000/day dry is both a 20–25 kVA generator and a 6-inch submersible.
    // Without the category hint the wet rate copied over would be Rs 8,000
    // instead of Rs 12,000 — a third off every wet hire.
    const gen = matchPortableClass(null, 600_000, "Generator");
    const pump = matchPortableClass(null, 600_000, "Submersible Pump");
    expect("cls" in gen && gen.cls.id).toBe("generator/20-25kva");
    expect("cls" in pump && pump.cls.id).toBe("submersible/6in");
    // With no hint at all the figure is ambiguous, so it refuses to choose.
    expect(matchPortableClass(null, 600_000, null).kind).toBe("off-card");
  });

  it("reports a machine with neither rate as unpriced, not off-card", () => {
    expect(matchPortableClass(null, null, "Generator")).toEqual({ kind: "unpriced" });
  });

  it("reports a rate that is on no class as off-card", () => {
    // CM-24 is priced dry at Rs 3,000. v10 gave concrete mixers a category, but
    // no class sits at 3,000 — the 1-bag diesel is 2,800 and the 1½-bag 3,200 —
    // so it stays off-card and a person picks. Guessing which way to round would
    // be inventing a price.
    expect(matchPortableClass(null, 300_000, "Concrete Mixer").kind).toBe("off-card");
    expect(matchPortableClass(999_900, 111_100, "Generator").kind).toBe("off-card");
  });

  it("refuses a dry-only match when v10 put two classes on the same dry rate", () => {
    // The diamond floor saw and the asphalt cutter are both Rs 10,000 wet and
    // Rs 7,000 dry. A dry-only machine at 7,000 could be either, so it is left
    // off-card rather than assigned the wrong one — and picking either would
    // have handed it the same wet rate anyway, which is what makes this safe.
    expect(matchPortableClass(null, 700_000, "Concrete Saw").kind).toBe("off-card");
    // With both figures present the pair still resolves, to the first match.
    expect(matchPortableClass(1_000_000, 700_000, "Concrete Saw").kind).toBe("exact");
  });

  it("matches the v10 classes once a machine is priced from them", () => {
    const m = matchPortableClass(320_000, 220_000, "Concrete Mixer");
    expect(m.kind).toBe("exact");
    expect("cls" in m && m.cls.id).toBe("mixer/1bag-electric");
    const r = matchPortableClass(null, 240_000, "Power Tool — Other");
    expect(r.kind).toBe("dry-only");
    expect("cls" in r && r.cls.id).toBe("tool/tamping-rammer");
  });

  it("matches a non-powered item where wet and dry are the same figure", () => {
    const m = matchPortableClass(40_000, 40_000, "Site Accessory");
    expect(m.kind).toBe("exact");
    expect("cls" in m && m.cls.id).toBe("accessory/wheelbarrow");
  });

  it("matches a wet-only machine", () => {
    const m = matchPortableClass(1_800_000, null, "Generator");
    expect(m.kind).toBe("wet-only");
    expect("cls" in m && m.cls.id).toBe("generator/30-50kva");
  });

  it("does not call a partial match exact", () => {
    // The dry figure belongs to 20–25 kVA, the wet figure to 30–50 kVA.
    expect(matchPortableClass(1_800_000, 600_000, "Generator").kind).toBe("off-card");
  });
});
