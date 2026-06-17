import { prisma } from "../db";

// Default billing configuration. Persisted in the Setting key/value table under
// the "billing.*" namespace and editable from the admin billing console.
export const BILLING_DEFAULTS = {
  enabled: true,
  cron: "0 3 1 * *", // 03:00 on the 1st — bills the previous month
  minHours: 120,
  minKm: 0,
  minDays: 26,
  ssclRate: 0.025, // SSCL 2.5%
  vatRate: 0.18, // VAT 18%
  dueDays: 30,
  invoicePrefix: "EC-INV",
  fuelRateFallbackCents: 0, // price/L fallback when issues carry no priced total
};

export interface BillingConfig {
  enabled: boolean;
  cron: string;
  minHours: number;
  minKm: number;
  minDays: number;
  ssclRate: number;
  vatRate: number;
  dueDays: number;
  invoicePrefix: string;
  fuelRateFallbackCents: number;
}

const KEY = (k: string) => `billing.${k}`;

function num(map: Record<string, string>, key: string, fallback: number): number {
  const raw = map[KEY(key)];
  if (raw == null) return fallback;
  const n = parseFloat(raw);
  return isNaN(n) ? fallback : n;
}

// Loads all billing.* settings in a single query and returns a typed config
// with defaults applied for any missing keys.
export async function getBillingConfig(): Promise<BillingConfig> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: "billing." } },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  return {
    enabled: (map[KEY("enabled")] ?? String(BILLING_DEFAULTS.enabled)) !== "false",
    cron: map[KEY("cron")] || BILLING_DEFAULTS.cron,
    minHours: num(map, "minHours", BILLING_DEFAULTS.minHours),
    minKm: num(map, "minKm", BILLING_DEFAULTS.minKm),
    minDays: num(map, "minDays", BILLING_DEFAULTS.minDays),
    ssclRate: num(map, "ssclRate", BILLING_DEFAULTS.ssclRate),
    vatRate: num(map, "vatRate", BILLING_DEFAULTS.vatRate),
    dueDays: num(map, "dueDays", BILLING_DEFAULTS.dueDays),
    invoicePrefix: map[KEY("invoicePrefix")] || BILLING_DEFAULTS.invoicePrefix,
    fuelRateFallbackCents: num(map, "fuelRateFallbackCents", BILLING_DEFAULTS.fuelRateFallbackCents),
  };
}

// Minimum guaranteed units for a billing mode, from config.
export function minimumForMode(
  cfg: BillingConfig,
  mode: "hourly" | "perkm" | "perday"
): number {
  if (mode === "perkm") return cfg.minKm;
  if (mode === "perday") return cfg.minDays;
  return cfg.minHours;
}
