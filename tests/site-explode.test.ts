// A multi-site bill's value must reach the sites that earned it — all of it,
// and only once.
//
// The defect: every site-wise report grouped by Bill.projectId, the single site
// on the bill header. HEX-37 spent 13 days at Awissawella, 12 at Galagedara and
// 6 at Badalgama Plant in July 2026; the consolidated bill charged Awissawella
// the whole Rs 1,203,034.82 and the other two sites nothing. 172 of 717 bills
// span more than one site, so this was not a rare corner.
//
// The rule these tests hold to: split by the value each site was charged, and
// never lose or invent a cent doing it.

import { describe, expect, it } from "vitest";
import { apportionCents, explodeBillsBySite } from "../src/lib/billing/site-explode";

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

describe("apportioning cents", () => {
  it("splits in proportion to the weights", () => {
    expect(apportionCents(1000, [1, 1])).toEqual([500, 500]);
    expect(apportionCents(1000, [3, 1])).toEqual([750, 250]);
  });

  it("never loses the cent that rounding drops", () => {
    // Three equal shares of Rs 100.00 round to 33.33 and lose a cent.
    const parts = apportionCents(10000, [1, 1, 1]);
    expect(sum(parts)).toBe(10000);
    expect(parts).toEqual([3334, 3333, 3333]);
  });

  it("gives the residual to the largest share, where it is least visible", () => {
    const parts = apportionCents(10001, [5, 3, 2]);
    expect(sum(parts)).toBe(10001);
    expect(parts[0]).toBeGreaterThan(parts[1]);
  });

  it("holds for the real HEX-37 shares", () => {
    const weights = [27095032, 64845273, 7525161]; // Awissawella, Galagedara, Badalgama
    for (const total of [2486637, 18351379, 120303482]) {
      expect(sum(apportionCents(total, weights))).toBe(total);
    }
  });

  it("survives zero weights, a single share, and nothing at all", () => {
    expect(sum(apportionCents(999, [0, 0, 0]))).toBe(999);
    expect(apportionCents(999, [4])).toEqual([999]);
    expect(apportionCents(999, [])).toEqual([]);
  });

  it("handles a credit note, which is money going the other way", () => {
    const parts = apportionCents(-10000, [1, 1, 1]);
    expect(sum(parts)).toBe(-10000);
  });
});

// A bill shaped like HEX-37's July: three sites, wet at two of them, dry at the
// yard, with the fuel drawn only where the machine was on wet hire.
const hex37 = {
  id: "bill-hex37",
  assetCode: "HEX-37",
  projectId: "p-awi",
  projectName: "Awissawella",
  projectCode: "AWIISAWELLA",
  rentalAmountCents: 48381466,
  fuelCostCents: 51084000,
  fuelLitres: 1320,
  billableUnits: 125.37,
  actualMeterUnits: 118,
  subtotalCents: 99465466,
  ssclCents: 2486637,
  vatCents: 18351379,
  grandTotalCents: 120303482,
  lineItems: [
    { kind: "FUEL", description: "Fuel issued — AWIISAWELLA (Wet)", quantity: 180, amountCents: 6966000, projectId: "p-awi", projectName: "Awissawella" },
    { kind: "RENTAL", description: "Machine rental — AWIISAWELLA · hourly (W) · 13 days", quantity: 50.32, amountCents: 20129032, projectId: "p-awi", projectName: "Awissawella" },
    { kind: "RENTAL", description: "Machine rental — BGP · hourly (D) · 6 days", quantity: 23.22, amountCents: 7525161, projectId: "p-bgp", projectName: "Badalgama Plant" },
    { kind: "FUEL", description: "Fuel issued — CEP-03F (Wet)", quantity: 1140, amountCents: 44118000, projectId: "p-cep", projectName: "CEP-03 F (Galagedara)" },
    { kind: "RENTAL", description: "Machine rental — CEP-03F · hourly (W) · 12 days", quantity: 51.81, amountCents: 20727273, projectId: "p-cep", projectName: "CEP-03 F (Galagedara)" },
  ],
};

const codes = new Map([["p-awi", "AWIISAWELLA"], ["p-bgp", "BGP"], ["p-cep", "CEP-03F"]]);

describe("a vehicle that worked three sites", () => {
  const portions = explodeBillsBySite([hex37], codes);
  const at = (name: string) => portions.find((p) => p.projectName === name)!;

  it("appears once under each site, not three times under the header site", () => {
    expect(portions).toHaveLength(3);
    expect(new Set(portions.map((p) => p.projectName))).toEqual(
      new Set(["Awissawella", "Badalgama Plant", "CEP-03 F (Galagedara)"])
    );
  });

  it("charges each site only what it was billed", () => {
    expect(at("Awissawella").subtotalCents).toBe(27095032);       // Rs 270,950.32
    expect(at("CEP-03 F (Galagedara)").subtotalCents).toBe(64845273); // Rs 648,452.73
    expect(at("Badalgama Plant").subtotalCents).toBe(7525161);    // Rs 75,251.61
  });

  it("adds back to the bill exactly — subtotal, both taxes and the grand total", () => {
    expect(sum(portions.map((p) => p.subtotalCents))).toBe(hex37.subtotalCents);
    expect(sum(portions.map((p) => p.ssclCents))).toBe(hex37.ssclCents);
    expect(sum(portions.map((p) => p.vatCents))).toBe(hex37.vatCents);
    expect(sum(portions.map((p) => p.grandTotalCents))).toBe(hex37.grandTotalCents);
    expect(sum(portions.map((p) => p.rentalAmountCents))).toBe(hex37.rentalAmountCents);
    expect(sum(portions.map((p) => p.fuelCostCents))).toBe(hex37.fuelCostCents);
    expect(sum(portions.map((p) => p.fuelLitres))).toBe(hex37.fuelLitres);
  });

  it("sends the fuel to the site that drew it", () => {
    expect(at("CEP-03 F (Galagedara)").fuelLitres).toBe(1140);
    expect(at("Awissawella").fuelLitres).toBe(180);
    expect(at("Badalgama Plant").fuelLitres).toBe(0); // dry hire at our own yard
    expect(at("Badalgama Plant").fuelCostCents).toBe(0);
  });

  it("carries each site's own code, so a site filter finds its portion", () => {
    expect(at("CEP-03 F (Galagedara)").projectCode).toBe("CEP-03F");
    expect(at("Badalgama Plant").projectCode).toBe("BGP");
  });

  it("records the days behind each portion", () => {
    expect(at("Awissawella").assignedDays).toBe(13);
    expect(at("CEP-03 F (Galagedara)").assignedDays).toBe(12);
    expect(at("Badalgama Plant").assignedDays).toBe(6);
  });

  it("shows no per-site meter reading, because there is only one for the month", () => {
    // Inventing a per-site split of the meter would be a number nobody measured.
    for (const p of portions) expect(p.actualMeterUnits).toBeNull();
  });

  it("keeps the portions traceable to the one real bill", () => {
    for (const p of portions) {
      expect(p.sourceBillId).toBe("bill-hex37");
      expect(p.isSitePortion).toBe(true);
    }
    expect(new Set(portions.map((p) => p.id)).size).toBe(3); // ids stay unique
    expect(sum(portions.map((p) => p.siteShare))).toBeCloseTo(1, 10);
  });
});

describe("bills that must not be touched", () => {
  it("passes a single-site bill through whole", () => {
    const single = {
      ...hex37, id: "b1",
      lineItems: hex37.lineItems.filter((l) => l.projectId === "p-awi"),
    };
    const [p] = explodeBillsBySite([single], codes);
    expect(p.id).toBe("b1");
    expect(p.isSitePortion).toBe(false);
    expect(p.grandTotalCents).toBe(hex37.grandTotalCents);
    expect(p.actualMeterUnits).toBe(118); // the real meter still shown
  });

  it("passes a bill with no line items through whole", () => {
    const [p] = explodeBillsBySite([{ ...hex37, id: "b2", lineItems: [] }], codes);
    expect(p.id).toBe("b2");
    expect(p.isSitePortion).toBe(false);
  });

  it("does not drop a line item whose site was never recorded", () => {
    const legacy = {
      ...hex37, id: "b3",
      lineItems: [
        { kind: "RENTAL", description: "Machine rental · 20 days", quantity: 100, amountCents: 60000000, projectId: null, projectName: null },
        hex37.lineItems[2],
      ],
    };
    const portions = explodeBillsBySite([legacy], codes);
    expect(portions).toHaveLength(2);
    expect(sum(portions.map((p) => p.grandTotalCents))).toBe(hex37.grandTotalCents);
  });
});

describe("the whole month reconciles", () => {
  it("leaves the month's total unchanged however many bills split", () => {
    const bills = [
      hex37,
      { ...hex37, id: "b-single", lineItems: hex37.lineItems.filter((l) => l.projectId === "p-bgp") },
      { ...hex37, id: "b-two", lineItems: hex37.lineItems.filter((l) => l.projectId !== "p-awi") },
    ];
    const before = sum(bills.map((b) => b.grandTotalCents));
    const after = sum(explodeBillsBySite(bills, codes).map((p) => p.grandTotalCents));
    expect(after).toBe(before);
  });
});

// The two columns the consolidated bill gained when the make-and-model column
// came out: how many days the machine was HERE, and what the diesel drawn HERE
// says it did. Both have to be per-site or the invoice states the whole month's
// figures under one site's name.
describe("days and fuel-implied work, per site", () => {
  it("gives each site only its own days", () => {
    const byCode = Object.fromEntries(
      explodeBillsBySite([hex37], codes).map((p) => [p.projectCode, p])
    );
    expect(byCode.AWIISAWELLA.assignedDays).toBe(13);
    expect(byCode["CEP-03F"].assignedDays).toBe(12);
    expect(byCode.BGP.assignedDays).toBe(6);
  });

  it("scales the fuel-implied work by the litres that site drew", () => {
    // 1,320 L across the month imply 118 hours; Galagedara drew 1,140 of them.
    const byCode = Object.fromEntries(
      explodeBillsBySite([{ ...hex37, derivedStandardUnits: 118 }], codes).map((p) => [p.projectCode, p])
    );
    expect(byCode["CEP-03F"].derivedStandardUnits).toBeCloseTo(118 * (1140 / 1320), 6);
    expect(byCode.AWIISAWELLA.derivedStandardUnits).toBeCloseTo(118 * (180 / 1320), 6);
  });

  it("says nothing rather than zero where a site drew no diesel", () => {
    // Badalgama had the machine on dry hire for six days and issued nothing.
    // A printed 0 would claim the fuel proves it did no work; the truth is that
    // there is no fuel here to prove anything either way.
    const byCode = Object.fromEntries(
      explodeBillsBySite([{ ...hex37, derivedStandardUnits: 118 }], codes).map((p) => [p.projectCode, p])
    );
    expect(byCode.BGP.derivedStandardUnits).toBeNull();
  });

  it("says nothing when the bill itself never derived a figure", () => {
    const byCode = Object.fromEntries(
      explodeBillsBySite([{ ...hex37, derivedStandardUnits: null }], codes).map((p) => [p.projectCode, p])
    );
    expect(byCode["CEP-03F"].derivedStandardUnits).toBeNull();
  });

  it("the site portions' days add up to the month's", () => {
    const parts = explodeBillsBySite([hex37], codes);
    expect(parts.reduce((s, p) => s + p.assignedDays, 0)).toBe(31);
  });
});

// The rate a site was actually charged at.
//
// Bill.rateCents holds ONE rate — the dominant segment's — and a month can be
// charged at more than one: wet hire at a client site, dry hire back at the
// yard. Sixteen bills between May and August carry two. Printing the header
// rate beside a site's own money is then simply wrong, and it is what sent the
// owner looking for a missing Rs 3,658:
//
//   PC-02 spent one day of July at Wadakada on dry hire. The charge is
//   3.87 hr × Rs 3,860 = Rs 14,941.94. The page printed "4 hr @ Rs 4,650",
//   which multiplies to Rs 18,600 and matches nothing on the invoice.
describe("the rate each site was charged at", () => {
  const pc02 = {
    id: "bill-pc02",
    assetCode: "PC-02",
    projectId: "p-cep03e",
    projectName: "CEP-03 E Package",
    projectCode: "CEP-03E",
    rateCents: 465000,        // the header: the dominant WET segment
    rateBasis: "w",
    rentalAmountCents: 55494194,
    fuelCostCents: 5805000,
    fuelLitres: 150,
    billableUnits: 120,
    subtotalCents: 61299194,
    ssclCents: 1532480,
    vatCents: 11309761,
    grandTotalCents: 74141435,
    lineItems: [
      { kind: "RENTAL", description: "Machine rental — CEP-03W · hourly (D) · 1 day", quantity: 3.870967741935484, unitRateCents: 386000, amountCents: 1494194, projectId: "p-cepw", projectName: "CEP-03 Wadakada" },
      { kind: "RENTAL", description: "Machine rental — CEP-03E · hourly (W) · 17 days", quantity: 65.80645161290322, unitRateCents: 465000, amountCents: 30600000, projectId: "p-cep03e", projectName: "CEP-03 E Package" },
      { kind: "RENTAL", description: "Machine rental — ING · hourly (W) · 13 days", quantity: 50.32258064516129, unitRateCents: 465000, amountCents: 23400000, projectId: "p-ing", projectName: "Inginimitiya" },
    ],
  };
  const pcCodes = new Map([["p-cepw", "CEP-03W"], ["p-cep03e", "CEP-03E"], ["p-ing", "ING"]]);

  it("gives Wadakada the dry rate it was actually charged, not the header's wet one", () => {
    const byCode = Object.fromEntries(explodeBillsBySite([pc02], pcCodes).map((p) => [p.projectCode, p]));
    expect(byCode["CEP-03W"].rateCents).toBe(386000);
    expect(byCode["CEP-03E"].rateCents).toBe(465000);
    expect(byCode.ING.rateCents).toBe(465000);
  });

  it("makes units × rate reconcile with the rental on every row", () => {
    for (const p of explodeBillsBySite([pc02], pcCodes)) {
      expect(Math.round(p.billableUnits * p.rateCents)).toBe(p.rentalAmountCents);
    }
  });

  it("carries the site's own hire basis, so a dry day is not labelled Wet", () => {
    const byCode = Object.fromEntries(explodeBillsBySite([pc02], pcCodes).map((p) => [p.projectCode, p]));
    expect(byCode["CEP-03W"].rateBasis).toBe("d");
    expect(byCode["CEP-03E"].rateBasis).toBe("w");
  });

  it("flags a weighted rate rather than passing one off as exact", () => {
    // One site holding two segments at different rates — BM-02's May at
    // Badalgama was billed both wet and dry.
    const mixed = {
      ...pc02,
      lineItems: [
        { kind: "RENTAL", description: "Machine rental — BGP · hourly (W) · 11 days", quantity: 42.58, unitRateCents: 260000, amountCents: 11070968, projectId: "p-bgp", projectName: "Badalgama" },
        { kind: "RENTAL", description: "Machine rental — BGP · hourly (D) · 11 days", quantity: 50.56, unitRateCents: 180000, amountCents: 9100000, projectId: "p-bgp", projectName: "Badalgama" },
        { kind: "RENTAL", description: "Machine rental — ING · hourly (W) · 3 days", quantity: 11.61, unitRateCents: 260000, amountCents: 3019355, projectId: "p-ing", projectName: "Inginimitiya" },
      ],
    };
    const byCode = Object.fromEntries(
      explodeBillsBySite([mixed], new Map([["p-bgp", "BGP"], ["p-ing", "ING"]])).map((p) => [p.projectCode, p]),
    );
    expect(byCode.BGP.rateBlended).toBe(true);
    expect(byCode.ING.rateBlended).toBe(false);
    // The weighted rate still reconciles against that site's own rental.
    expect(Math.round(byCode.BGP.billableUnits * byCode.BGP.rateCents)).toBeCloseTo(byCode.BGP.rentalAmountCents, -2);
    // And it cannot be mistaken for a real tier.
    expect(byCode.BGP.rateCents).toBeGreaterThan(180000);
    expect(byCode.BGP.rateCents).toBeLessThan(260000);
  });

  it("leaves a single-rate bill's rate exactly as charged", () => {
    const single = {
      ...pc02,
      lineItems: [{ kind: "RENTAL", description: "Machine rental — ING · hourly (W) · 31 days", quantity: 120, unitRateCents: 465000, amountCents: 55800000, projectId: "p-ing", projectName: "Inginimitiya" }],
    };
    const [p] = explodeBillsBySite([single], pcCodes);
    expect(p.rateCents).toBe(465000);
    expect(p.rateBlended).toBe(false);
  });
});
