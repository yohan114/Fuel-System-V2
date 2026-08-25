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
  it("carries all 36 classes from the workbook sheet", () => {
    expect(PORTABLE_CLASSES).toHaveLength(36);
  });

  it("gives every class a unique id", () => {
    expect(new Set(PORTABLE_CLASSES.map((k) => k.id)).size).toBe(36);
  });

  it("prices wet above dry everywhere — a wet hire includes fuel and an operator", () => {
    for (const k of PORTABLE_CLASSES) {
      expect(k.wetCents, k.id).toBeGreaterThan(k.dryCents);
    }
  });

  it("holds figures in cents, matching the sheet's rupees", () => {
    expect(portableClassById("generator/20-25kva")).toMatchObject({ wetCents: 1_200_000, dryCents: 600_000 });
    expect(portableClassById("compressor/185cfm")).toMatchObject({ wetCents: 1_600_000, dryCents: 1_100_000 });
    expect(portableClassById("welding/300a-diesel")).toMatchObject({ wetCents: 950_000, dryCents: 650_000 });
  });

  it("returns null for an id that is not on the card", () => {
    expect(portableClassById("generator/999kva")).toBeNull();
  });

  it("groups into the sheet's ten categories", () => {
    expect(PORTABLE_CATEGORIES).toEqual([
      "Generator", "Air Compressor", "Poker / Concrete Vibrator", "Submersible Pump",
      "Engine Water Pump", "Rotary Hammer", "Circular Saw", "Angle Grinder",
      "Power Tool — Other", "Welding Plant",
    ]);
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

  it("admits when it does not know", () => {
    expect(guessCardCategory("Concrete Mixer (1-2 bag)", "C. Mixcher")).toBeNull();
    expect(guessCardCategory(null, undefined, "")).toBeNull();
    expect(cardCategoryForCode("CM-24")).toBeNull();
    expect(cardCategoryForCode(null)).toBeNull();
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
    // CM-24's Rs 3,000 concrete mixer: the portable sheet has no mixer class.
    expect(matchPortableClass(null, 300_000, null).kind).toBe("off-card");
    expect(matchPortableClass(999_900, 111_100, "Generator").kind).toBe("off-card");
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
