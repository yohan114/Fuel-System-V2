import { computeWindowDelta, sumFuelForWindow } from "../billing/usage";

// "System-recommended hours/km" = fuel issued ÷ the typical consumption rate
// (RentalRate.fuelConsTyp, L/hr or L/km). It is an independent, fuel-derived
// estimate of how much the vehicle actually ran, used to cross-check the
// recorded meter. Signed fuel-issue records are hard to under-report, so a
// recommended figure well above the recorded meter Δ flags an under-recorded
// meter (possible off-meter running or fuel misuse).

// Variance beyond this fraction (20%) is flagged.
export const VARIANCE_THRESHOLD = 0.2;

// "METER_LOW"  = recommended ≫ actual meter (meter likely under-recorded).
// "METER_HIGH" = actual meter ≫ recommended (meter high / very efficient run).
export type VarianceFlag = "OK" | "METER_LOW" | "METER_HIGH";

export interface MeterVsFuel {
  actualMeter: number; // recorded cumulative meter growth in the window
  recommended: number | null; // fuel-derived units (litres ÷ typical rate)
  fuelLitres: number;
  ratePerUnit: number | null; // fuelConsTyp used (L per hr/km)
  variancePct: number | null; // (recommended − actualMeter) / max(actualMeter, 1)
  flag: VarianceFlag;
}

// litres ÷ typical consumption rate. Null when no usable rate; 0 when no fuel.
export function recommendedUnits(
  litres: number,
  fuelConsTyp: number | null | undefined
): number | null {
  if (!fuelConsTyp || fuelConsTyp <= 0) return null;
  if (litres <= 0) return 0;
  return litres / fuelConsTyp;
}

// Compares recorded meter growth against the fuel-derived recommendation and
// returns the signed variance plus a flag. Suppressed (OK, null) when there is
// no recommendation to compare against.
export function varianceFlag(
  actualMeter: number,
  recommended: number | null
): { variancePct: number | null; flag: VarianceFlag } {
  if (recommended == null) return { variancePct: null, flag: "OK" };
  const variancePct = (recommended - actualMeter) / Math.max(actualMeter, 1);
  let flag: VarianceFlag = "OK";
  if (Math.abs(variancePct) >= VARIANCE_THRESHOLD) {
    flag = variancePct > 0 ? "METER_LOW" : "METER_HIGH";
  }
  return { variancePct, flag };
}

// Per-asset recommended-vs-actual over an arbitrary window. Reuses the billing
// meter/fuel helpers so the numbers stay consistent with bills and reports.
export async function computeMeterVsFuel(
  assetId: string,
  from: Date,
  to: Date,
  meterType: "KM" | "HOURS",
  fuelConsTyp: number | null | undefined,
  projectCode?: string | null
): Promise<MeterVsFuel> {
  const [rd, fuel] = await Promise.all([
    computeWindowDelta(assetId, meterType, from, to, projectCode),
    sumFuelForWindow(assetId, from, to),
  ]);
  const actualMeter = rd.delta;
  const recommended = recommendedUnits(fuel.litres, fuelConsTyp);
  const { variancePct, flag } = varianceFlag(actualMeter, recommended);
  return {
    actualMeter,
    recommended,
    fuelLitres: fuel.litres,
    ratePerUnit: fuelConsTyp && fuelConsTyp > 0 ? fuelConsTyp : null,
    variancePct,
    flag,
  };
}
