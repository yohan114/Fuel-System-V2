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
  autoEmailOnIssue: false, // email the invoice PDF to the site contact on finalize
  // Site codes that are E&C's own locations rather than client sites, comma
  // separated (e.g. "BADAL-WS"). Machines sitting at an internal location are
  // not rented to anyone, so billing them the guaranteed monthly minimum
  // invents revenue against a site that has no customer to invoice — Badalgama
  // Workshop alone produced Rs. 23.8M of June bills, 83 of them for machines
  // that burned no fuel and moved no meter.
  //
  // CAVEAT — this also drops the FUEL drawn during an excluded stretch. On the
  // segmented path generate.ts filters the segments before the per-segment fuel
  // sum, so litres dated inside an excluded window are never added to the pot
  // and are not re-attributed to any other site: nobody is billed for them. On
  // the current data that is 132 issues, 13,455.6 L, Rs. 3,866,407. If E&C wants
  // to recharge diesel drawn at its own yard, the segment needs to be priced at
  // zero rental rather than removed.
  excludeSiteCodes: "",
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
  autoEmailOnIssue: boolean;
  /** Upper-cased site codes that are never billed (E&C's own locations). */
  excludeSiteCodes: string[];
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
    autoEmailOnIssue: (map[KEY("autoEmailOnIssue")] ?? String(BILLING_DEFAULTS.autoEmailOnIssue)) === "true",
    excludeSiteCodes: parseSiteCodes(map[KEY("excludeSiteCodes")] ?? BILLING_DEFAULTS.excludeSiteCodes),
  };
}

/** "BADAL-WS, hq" -> ["BADAL-WS", "HQ"]. Tolerates spaces, blanks and case. */
export function parseSiteCodes(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
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
