import { basisLabel, unitLabel, type BillingMode, type RateBasis } from "./calc";

// Pure multi-site billing math. persistSegmentedBill fetches each assignment
// segment's raw facts from the DB (meter delta / working days, fuel) and hands
// them here; this module turns them into the per-site line items and the
// bill-level money. Keeping it DB-free makes the multi-site arithmetic — the
// prorated minimum, per-segment rounding, fuel-derived override — provable to
// the cent in tests, and makes the line items the single source of truth: the
// subtotal is the sum of the RENTAL and (charged) FUEL lines, nothing computed
// twice.

export interface SegmentInput {
  projectId: string | null;
  projectName: string | null;
  projectCode: string;
  days: number; // assigned days in this segment
  rawUnits: number; // recorded meter delta (metered modes) or working days (perday)
  fuelLitres: number; // fuel BILLED to this segment (may be source-reattributed)
  fuelCostCents: number; // cost of the billed fuel
  // Litres used to estimate physical work when the meter is missing (fuel-derived
  // units). This is the fuel actually burnt on-site during the segment's days
  // (date-window), which can differ from the billed fuel above when the latter is
  // re-attributed by source. Defaults to fuelLitres when omitted so single-site
  // and legacy callers are unaffected.
  derivLitres?: number;
  // The hire basis THIS SITE was allocated on ("fw" | "w" | "d"), taken from the
  // allocation's Dry/Wet type. A vehicle can be allocated Dry to one site and Wet
  // to another within one month; each site must then be billed on its own terms —
  // its own rate tier, and fuel charged only where that allocation says Wet.
  // Undefined means "use the bill-level basis", which is what every single-site
  // and legacy caller relies on.
  rateBasis?: RateBasis;
  // The rate-card tier for this segment's basis. Null = the card has no tier for
  // this mode/basis pair, so the segment prices at zero and the line says so.
  rateCents?: number | null;
}

export interface SegmentedConfig {
  billingMode: BillingMode;
  rateBasis: RateBasis;
  rateCents: number;
  pickedRate: number | null; // null = no rate-card tier for this mode/basis
  minimumUnits: number; // the FULL monthly guarantee (e.g. 120 h); prorated below
  daysInMonth: number; // calendar days in the billing month — the proration base
  fuelConsTyp: number | null;
  fuelConsEcon: number | null;
  ssclRate: number;
  vatRate: number;
  breakdownDays: number;
  workingDays: number; // period-level, for the breakdown deduction estimate
  // Fuel-only bill: a privately-owned vehicle E&C fuels but does not rent. No
  // per-site RENTAL line is emitted and the issued fuel is always charged, so
  // the subtotal is fuel alone across all the sites it was fuelled at.
  fuelOnly?: boolean;
}

export interface SegmentedLine {
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  unitRateCents: number;
  amountCents: number;
  projectId: string | null;
  projectName: string | null;
}

export interface SegmentedResult {
  lineItems: SegmentedLine[];
  actualUnitsSum: number;
  rawMeterSum: number;
  derivedStdSum: number;
  derivedEconSum: number;
  minimumUnitsProrated: number; // Σ per-segment prorated minimum (availability-adjusted)
  billableSum: number;
  rentalSum: number;
  litresSum: number;
  fuelCostSum: number;
  fuelChargedCents: number;
  breakdownDeductCents: number;
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
  derivedFromFuel: boolean;
  fuelConsMidRate: number | null;
}

export function computeSegmentedTotals(segments: SegmentInput[], cfg: SegmentedConfig): SegmentedResult {
  const unit = unitLabel(cfg.billingMode);
  const isMeter = cfg.billingMode === "hourly" || cfg.billingMode === "perkm";
  // Whether a given hire basis includes the fuel. Evaluated PER SEGMENT below,
  // because a vehicle can be allocated Dry to one site and Wet to another in the
  // same month and each site must be billed on the terms it was allocated on.
  const chargesFuelOn = (basis: RateBasis) => !!cfg.fuelOnly || basis === "fw" || basis === "w";
  // The guaranteed minimum is prorated by AVAILABILITY: each assigned day is
  // worth (monthly minimum ÷ calendar days), so a vehicle posted for only part
  // of the month (e.g. it arrived mid-month) owes only its share, and a vehicle
  // present the whole month owes exactly the full minimum. This replaces the
  // old "share of assigned days" split, which billed the full minimum even for
  // a few days on site.
  const daysInMonth = cfg.daysInMonth > 0 ? cfg.daysInMonth : 30;

  const rentalLines: SegmentedLine[] = [];
  const fuelLines: SegmentedLine[] = [];

  let actualUnitsSum = 0;
  let rawMeterSum = 0;
  let derivedStdSum = 0;
  let derivedEconSum = 0;
  let minimumUnitsProrated = 0;
  let billableSum = 0;
  let rentalSum = 0;
  let litresSum = 0;
  let fuelCostSum = 0;
  let derivedFromFuel = false;
  let fuelConsMidRate: number | null = null;

  for (const seg of segments) {
    const minShare = cfg.minimumUnits * (seg.days / daysInMonth);

    const rawSeg = seg.rawUnits;
    let actualSeg = seg.rawUnits;

    // Fuel-derived units: when metered movement is missing/low but fuel was
    // burnt, back the units out of the typical consumption rate. This estimates
    // physical work, so it uses the fuel actually burnt on-site during the
    // segment's days (derivLitres), NOT the billed fuel — which may be
    // source-reattributed and would otherwise shift rental between sites.
    const derivLitres = seg.derivLitres ?? seg.fuelLitres;
    let dStd: number | null = null;
    let dEcon: number | null = null;
    let segDerived = false;
    // Same precedence as the single-site path: the standard band leads and the
    // meter is the fallback, but only when the band is quoted in the unit being
    // billed. A litres-per-hour figure divided into litres does not produce
    // kilometres. Magnitude identifies the basis — litres-per-km values are all
    // below 1 across the fleet, litres-per-hour all above.
    const bandUsable =
      cfg.fuelConsTyp != null &&
      cfg.fuelConsTyp > 0 &&
      (cfg.billingMode === "hourly" ? cfg.fuelConsTyp >= 1 : cfg.fuelConsTyp < 1);

    if (isMeter && derivLitres > 0 && bandUsable) {
      dStd = derivLitres / cfg.fuelConsTyp!;
      if (cfg.fuelConsEcon && cfg.fuelConsEcon > 0) dEcon = derivLitres / cfg.fuelConsEcon;

      actualSeg = dStd;
      segDerived = true;
      derivedFromFuel = true;
      fuelConsMidRate = cfg.fuelConsTyp;
    }

    if (cfg.billingMode === "hourly") {
      const maxSegHours = 24 * seg.days; // physical ceiling: 24 h per assigned day
      if (actualSeg > maxSegHours) actualSeg = maxSegHours;
    }
    if (cfg.billingMode === "perkm") {
      const maxSegKm = 200 * seg.days;
      if (actualSeg > maxSegKm) actualSeg = maxSegKm;
    }

    // This site's own hire terms. When the allocation named a Dry/Wet type the
    // segment carries its own basis and its own rate-card tier; otherwise it
    // falls back to the bill-level basis, which is what single-site bills use.
    const segBasis: RateBasis = seg.rateBasis ?? cfg.rateBasis;
    const segPicked = seg.rateBasis != null ? seg.rateCents ?? null : cfg.pickedRate;
    const segRateCents = segPicked ?? 0;
    const segChargesFuel = chargesFuelOn(segBasis);

    const billableSeg = Math.max(actualSeg, minShare);
    // Fuel-only vehicles are not rented — no rental accrues for any segment.
    const rentalSeg = cfg.fuelOnly ? 0 : Math.round(billableSeg * segRateCents);

    rawMeterSum += rawSeg;
    actualUnitsSum += actualSeg;
    derivedStdSum += dStd ?? 0;
    derivedEconSum += dEcon ?? 0;
    minimumUnitsProrated += minShare;
    billableSum += billableSeg;
    rentalSum += rentalSeg;
    litresSum += seg.fuelLitres;
    // Only fuel on a Wet-allocated segment is charged. A Dry segment's litres
    // still appear on the bill header (the vehicle did burn them) but cost the
    // client nothing — that is what Dry means.
    if (segChargesFuel) fuelCostSum += seg.fuelCostCents;

    if (!cfg.fuelOnly) {
      rentalLines.push({
        kind: "RENTAL",
        description:
          segPicked == null
            ? `Machine rental — ${seg.projectCode} (no rate tier for ${cfg.billingMode}/${segBasis})`
            : `Machine rental — ${seg.projectCode} · ${cfg.billingMode} (${segBasis.toUpperCase()}) · ${seg.days} day${seg.days !== 1 ? "s" : ""}${segDerived ? " [units incl. fuel]" : ""}`,
        quantity: billableSeg,
        unit,
        unitRateCents: segRateCents,
        amountCents: rentalSeg,
        projectId: seg.projectId,
        projectName: seg.projectName,
      });
    }

    if (segChargesFuel && seg.fuelLitres > 0) {
      fuelLines.push({
        kind: "FUEL",
        description: cfg.fuelOnly
          ? `Fuel issued — ${seg.projectCode} (E&C-supplied, fuel only)`
          : `Fuel issued — ${seg.projectCode} (${basisLabel(segBasis)})`,
        quantity: seg.fuelLitres,
        unit: "L",
        unitRateCents: Math.round(seg.fuelCostCents / seg.fuelLitres),
        amountCents: seg.fuelCostCents,
        projectId: seg.projectId,
        projectName: seg.projectName,
      });
    }
  }

  const lineItems: SegmentedLine[] = [...rentalLines, ...fuelLines];
  // fuelCostSum already only accumulated the segments whose own basis charges
  // fuel, so a Dry segment contributes nothing here while its litres still show
  // on the header.
  const fuelChargedCents = fuelCostSum;

  // Breakdown deduction is an informational line only — it is not subtracted
  // from the subtotal (mirrors the single-site path).
  let breakdownDeductCents = 0;
  if (cfg.breakdownDays > 0 && isMeter) {
    const totalD = cfg.workingDays + cfg.breakdownDays;
    if (totalD > 0 && actualUnitsSum > 0) {
      breakdownDeductCents = Math.round((actualUnitsSum / totalD) * cfg.breakdownDays * cfg.rateCents);
    }
  }
  if (breakdownDeductCents > 0) {
    lineItems.push({
      kind: "ADJUSTMENT",
      description: `Breakdown deduction (${cfg.breakdownDays} day${cfg.breakdownDays !== 1 ? "s" : ""} out of service)`,
      quantity: cfg.breakdownDays,
      unit: "day",
      unitRateCents: 0,
      amountCents: -breakdownDeductCents,
      projectId: null,
      projectName: null,
    });
  }

  const subtotalCents = rentalSum + fuelChargedCents;
  const ssclCents = Math.round(subtotalCents * cfg.ssclRate);
  const vatCents = Math.round((subtotalCents + ssclCents) * cfg.vatRate);
  const grandTotalCents = subtotalCents + ssclCents + vatCents;

  return {
    lineItems,
    actualUnitsSum,
    rawMeterSum,
    derivedStdSum,
    derivedEconSum,
    minimumUnitsProrated,
    billableSum,
    rentalSum,
    litresSum,
    fuelCostSum,
    fuelChargedCents,
    breakdownDeductCents,
    subtotalCents,
    ssclCents,
    vatCents,
    grandTotalCents,
    derivedFromFuel,
    fuelConsMidRate,
  };
}

// The invariant that makes line items the source of truth: the subtotal equals
// the sum of the RENTAL and charged-FUEL lines (ADJUSTMENT lines are
// informational and excluded). Used by tests and the data-quality check.
export function sumChargedLineItems(lineItems: { kind: string; amountCents: number }[]): number {
  return lineItems
    .filter((l) => l.kind === "RENTAL" || l.kind === "FUEL")
    .reduce((s, l) => s + l.amountCents, 0);
}
