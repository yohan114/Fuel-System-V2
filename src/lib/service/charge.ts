import { prisma } from "../db";
import { SERVICE_SETTING_KEYS, DEFAULT_SERVICE_RATES, type ServiceRates } from "./defaults";

// Single source of truth for the service-sheet money math, mirrored on the
// client (DetailedServiceForm) for the live preview. Everything is in LKR cents.
//
// Labour = labourRateLow% of parts  when parts <= threshold
//        = labourRateHigh% of parts when parts >  threshold
// Sundry = sundryRate% of parts
// Total  = parts + labour + sundry
export interface ServiceTotals {
  partsSubtotalCents: number;
  labourRatePct: number;
  labourChargeCents: number;
  sundryRatePct: number;
  sundryAmountCents: number;
  grandTotalCents: number;
}

export function computeServiceTotals(partsSubtotalCents: number, rates: ServiceRates): ServiceTotals {
  const parts = Math.max(0, Math.round(partsSubtotalCents || 0));
  const labourRatePct = parts > rates.labourThresholdCents ? rates.labourRateHigh : rates.labourRateLow;
  const labourChargeCents = Math.round((parts * labourRatePct) / 100);
  const sundryAmountCents = Math.round((parts * rates.sundryRate) / 100);
  const grandTotalCents = parts + labourChargeCents + sundryAmountCents;
  return {
    partsSubtotalCents: parts,
    labourRatePct,
    labourChargeCents,
    sundryRatePct: rates.sundryRate,
    sundryAmountCents,
    grandTotalCents,
  };
}

// Read the editable rates from the Setting table, falling back to defaults for
// any key that has not been set yet.
export async function getServiceRates(): Promise<ServiceRates> {
  const keys = Object.values(SERVICE_SETTING_KEYS);
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const v = map.get(key);
    if (v == null) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    labourRateLow: num(SERVICE_SETTING_KEYS.labourRateLow, DEFAULT_SERVICE_RATES.labourRateLow),
    labourRateHigh: num(SERVICE_SETTING_KEYS.labourRateHigh, DEFAULT_SERVICE_RATES.labourRateHigh),
    labourThresholdCents: num(SERVICE_SETTING_KEYS.labourThresholdCents, DEFAULT_SERVICE_RATES.labourThresholdCents),
    sundryRate: num(SERVICE_SETTING_KEYS.sundryRate, DEFAULT_SERVICE_RATES.sundryRate),
  };
}
