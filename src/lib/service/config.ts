import { prisma } from "../db";
import { SERVICE_DEFAULTS } from "./cost";

// Service costing config, persisted in the Setting table under the "service.*"
// namespace and editable from the admin service settings. Percentages are
// stored as fractions (0.15 = 15%).
export interface ServiceConfig {
  labourPct: number;
  sundryPct: number;
}

const KEY = (k: string) => `service.${k}`;

export async function getServiceConfig(): Promise<ServiceConfig> {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "service." } } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const num = (k: string, fallback: number) => {
    const raw = map[KEY(k)];
    if (raw == null) return fallback;
    const n = parseFloat(raw);
    return isNaN(n) ? fallback : n;
  };

  return {
    labourPct: num("labourPct", SERVICE_DEFAULTS.labourPct),
    sundryPct: num("sundryPct", SERVICE_DEFAULTS.sundryPct),
  };
}
