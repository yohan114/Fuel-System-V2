// The Rates section's data: every rate card's standard consumption band, the
// vehicle's measured burn, and how the two compare.
//
// The bands come from the 2026 Fleet Rental Prices workbook ("Fuel Rates"
// sheet). They are CLASS ESTIMATES, not measurements: the sheet sets Typical
// from the machine's model size class adjusted for age, then derives
// Econ = 0.72x Typ and Heavy = 1.35x Typ for machinery, and Econ = 1.28x,
// Heavy = 0.80x best economy for road vehicles. Every Dump Truck in the sheet
// therefore shares one band. That is fine for spotting an outlier and wrong for
// settling an argument about one machine, which is why this page shows the
// measured rate and the interval count next to the verdict rather than the
// verdict alone.

import { prisma } from "../db";
import { getConsumptionSeries, type AssetConsumptionSeries } from "../analytics/consumption-series";
import { type ConsBasis, toDisplay, displayUnit, resolveBand } from "./band";
import type { ConsumptionState } from "../analytics/consumption";

export interface RateBandRow {
  assetId: string;
  code: string;
  regNo: string | null;
  typeLabel: string | null;
  categoryName: string | null;
  projectName: string | null;
  status: string;
  meterType: string;
  hasRateCard: boolean;
  /** Storage units (L/hr or L/km). */
  econ: number | null;
  typ: number | null;
  heavy: number | null;
  basis: ConsBasis | null;
  /** Display units — km/L for road vehicles, matching the rate sheet. */
  econDisplay: number | null;
  typDisplay: number | null;
  heavyDisplay: number | null;
  unit: string;
  comparable: boolean;
  bandReason: string;
  /** Measured burn, display units. Null when it cannot be measured. */
  actualDisplay: number | null;
  intervals: number;
  state: ConsumptionState | null;
  severity: number;
  totalLitres: number;
  emptyReason: string | null;

  // ── what the machine is CHARGED at ────────────────────────────────────────
  //
  // The consumption band says what a machine burns; these say what the client
  // pays for it. They lived on separate screens, so nobody could see that a
  // machine burning well above its band was also priced below its class — the
  // two facts only mean something next to each other.
  /** Which trio of rates actually applies to this machine. */
  chargeMode: "hourly" | "perkm" | "perday";
  /** Rs/hr, Rs/km or Rs/day for that mode, in cents. Null where a tier is unset. */
  dryCents: number | null;
  wetCents: number | null;
  fullyWetCents: number | null;
  /** The tier a bill falls to by default: "d" | "w" | "fw". */
  defaultBasis: string | null;
  equipType: string | null;
}

type ChargeMode = "hourly" | "perkm" | "perday";

/**
 * Which rate columns apply. Mirrors defaultModeForAsset in the billing engine —
 * portable plant is priced by the day whatever meter it carries, a km odometer
 * means per-km, everything else is hourly.
 */
function chargeModeOf(equipType: string | null | undefined, meterType: string): ChargeMode {
  if (equipType === "PORTABLE") return "perday";
  if (meterType === "KM") return "perkm";
  return "hourly";
}

interface TierSource {
  hrFwCents: number | null; hrWCents: number | null; hrDCents: number | null;
  kmFwCents: number | null; kmWCents: number | null; kmDCents: number | null;
  dyFwCents: number | null; dyWCents: number | null; dyDCents: number | null;
  portDwCents: number | null; portDdCents: number | null;
}

/** The three tiers for the mode that applies, so the table shows one set, not eleven columns. */
function tiersOf(r: TierSource | null | undefined, mode: ChargeMode) {
  if (!r) return { dryCents: null, wetCents: null, fullyWetCents: null };
  if (mode === "perkm") return { dryCents: r.kmDCents, wetCents: r.kmWCents, fullyWetCents: r.kmFwCents };
  if (mode === "perday") {
    // Portable plant is priced off its own two columns; the generic daily
    // columns are what a non-portable machine hired by the day would use.
    const port = r.portDwCents != null || r.portDdCents != null;
    return port
      ? { dryCents: r.portDdCents, wetCents: r.portDwCents, fullyWetCents: null }
      : { dryCents: r.dyDCents, wetCents: r.dyWCents, fullyWetCents: r.dyFwCents };
  }
  return { dryCents: r.hrDCents, wetCents: r.hrWCents, fullyWetCents: r.hrFwCents };
}

/** The field each tier writes back to, so an edit lands where billing reads. */
export function rateFieldFor(mode: ChargeMode, tier: "d" | "w" | "fw", portable: boolean): string | null {
  if (mode === "perkm") return tier === "d" ? "kmDCents" : tier === "w" ? "kmWCents" : "kmFwCents";
  if (mode === "perday") {
    if (portable) return tier === "d" ? "portDdCents" : tier === "w" ? "portDwCents" : null;
    return tier === "d" ? "dyDCents" : tier === "w" ? "dyWCents" : "dyFwCents";
  }
  return tier === "d" ? "hrDCents" : tier === "w" ? "hrWCents" : "hrFwCents";
}

export interface RatesOverview {
  rows: RateBandRow[];
  counts: {
    total: number;
    withBand: number;
    withHeavy: number;
    noRateCard: number;
    noBand: number;
    basisConflict: number;
    measured: number;
    verdicts: number;
    over: number;
    heavy: number;
    normal: number;
    belowEcon: number;
  };
  /** Litres that sit inside a measurable interval, against all litres issued. */
  litresMeasured: number;
  litresTotal: number;
}

const STATE_RANK: Record<string, number> = {
  OVER: 0, HEAVY: 1, BELOW_ECON: 2, NORMAL: 3,
};

export async function getRatesOverview(): Promise<RatesOverview> {
  const [assets, series] = await Promise.all([
    prisma.asset.findMany({
      select: {
        id: true,
        code: true,
        regNo: true,
        typeLabel: true,
        status: true,
        meterType: true,
        category: { select: { name: true } },
        project: { select: { name: true } },
        rentalRate: {
          select: {
            fuelConsEcon: true, fuelConsTyp: true, fuelConsHeavy: true, fuelConsBasis: true,
            equipType: true, defaultBasis: true,
            hrFwCents: true, hrWCents: true, hrDCents: true,
            kmFwCents: true, kmWCents: true, kmDCents: true,
            dyFwCents: true, dyWCents: true, dyDCents: true,
            portDwCents: true, portDdCents: true,
          },
        },
      },
      orderBy: { code: "asc" },
    }),
    getConsumptionSeries(),
  ]);

  const rows: RateBandRow[] = [];
  let litresMeasured = 0;
  let litresTotal = 0;

  for (const a of assets) {
    const s: AssetConsumptionSeries | undefined = series.get(a.id);
    const band = resolveBand(a.rentalRate, a.meterType);
    // Display in the unit the band is quoted in, not the meter's — a band the
    // meter cannot measure is still worth showing on the rate card.
    const shownBasis: ConsBasis = band.basis ?? (a.meterType === "KM" ? "km" : "hr");

    litresTotal += s?.totalLitres ?? 0;
    litresMeasured += s?.points.reduce((n, p) => n + p.litres, 0) ?? 0;

    rows.push({
      assetId: a.id,
      code: a.code,
      regNo: a.regNo,
      typeLabel: a.typeLabel,
      categoryName: a.category?.name ?? null,
      projectName: a.project?.name ?? null,
      status: a.status,
      meterType: a.meterType,
      hasRateCard: a.rentalRate != null,
      econ: band.rawEcon,
      typ: band.rawTyp,
      heavy: band.rawHeavy,
      basis: band.basis,
      econDisplay: toDisplay(band.rawEcon, shownBasis),
      typDisplay: toDisplay(band.rawTyp, shownBasis),
      heavyDisplay: toDisplay(band.rawHeavy, shownBasis),
      unit: displayUnit(shownBasis),
      comparable: band.comparable,
      bandReason: band.reason,
      actualDisplay: s?.actualRate != null ? toDisplay(s.actualRate, s.basis) : null,
      intervals: s?.points.length ?? 0,
      state: s?.state ?? null,
      severity: s?.severity ?? 0,
      chargeMode: chargeModeOf(a.rentalRate?.equipType, a.meterType),
      ...tiersOf(a.rentalRate, chargeModeOf(a.rentalRate?.equipType, a.meterType)),
      defaultBasis: a.rentalRate?.defaultBasis ?? null,
      equipType: a.rentalRate?.equipType ?? null,
      totalLitres: s?.totalLitres ?? 0,
      emptyReason: s?.emptyReason ?? null,
    });
  }

  // Worst first: a machine burning over its heavy threshold is what this page
  // exists to surface. Unverdicted rows sort after, by fuel burned.
  rows.sort((x, y) => {
    const rx = x.state ? STATE_RANK[x.state] ?? 9 : 9;
    const ry = y.state ? STATE_RANK[y.state] ?? 9 : 9;
    return rx - ry || y.severity - x.severity || y.totalLitres - x.totalLitres || x.code.localeCompare(y.code);
  });

  const counts = {
    total: rows.length,
    withBand: rows.filter((r) => r.typ != null && r.typ > 0).length,
    withHeavy: rows.filter((r) => r.heavy != null).length,
    noRateCard: rows.filter((r) => r.bandReason === "no-rate-card").length,
    noBand: rows.filter((r) => r.bandReason === "no-band").length,
    basisConflict: rows.filter((r) => r.bandReason === "basis-conflict").length,
    measured: rows.filter((r) => r.intervals > 0).length,
    verdicts: rows.filter((r) => r.state != null).length,
    over: rows.filter((r) => r.state === "OVER").length,
    heavy: rows.filter((r) => r.state === "HEAVY").length,
    normal: rows.filter((r) => r.state === "NORMAL").length,
    belowEcon: rows.filter((r) => r.state === "BELOW_ECON").length,
  };

  return {
    rows,
    counts,
    litresMeasured: Math.round(litresMeasured),
    litresTotal: Math.round(litresTotal),
  };
}
