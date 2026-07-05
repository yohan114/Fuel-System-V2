import { prisma } from "../db";
import { computeWindowDelta } from "../billing/usage";

// Fuel-consumption health: the vehicle's actual burn rate (issued litres ÷
// running-chart meter growth) placed on its econ/typ/heavy band from the 2026
// rate sheet. Burning above HEAVY is a repair candidate (worn engine, leaks or
// fuel misuse); below ECON with real fuel suggests reporting problems.

export type ConsumptionState = "OVER" | "HEAVY" | "NORMAL" | "BELOW_ECON" | "NO_METER" | "NO_BAND";

export const STATE_ORDER: ConsumptionState[] = ["OVER", "HEAVY", "NORMAL", "BELOW_ECON", "NO_METER", "NO_BAND"];

// Pure: place an actual rate on the band. econ/typ/heavy may be partly null —
// classification uses what exists (typ alone can still say NORMAL vs HEAVY).
export function classifyConsumption(
  actual: number | null,
  econ: number | null,
  typ: number | null,
  heavy: number | null
): ConsumptionState {
  if (typ == null && heavy == null && econ == null) return "NO_BAND";
  if (actual == null || actual <= 0) return "NO_METER";
  if (heavy != null && actual > heavy) return "OVER";
  if (typ != null && actual > typ) return "HEAVY";
  if (econ != null && actual < econ) return "BELOW_ECON";
  return "NORMAL";
}

export interface ConsumptionRow {
  assetId: string;
  code: string;
  categoryName: string;
  projectName: string | null;
  meterType: string;
  unit: "hr" | "km";
  litres: number;
  meterDelta: number; // 0 = no usable meter movement in the window
  actualRate: number | null; // L per hr/km
  econ: number | null;
  typ: number | null;
  heavy: number | null;
  state: ConsumptionState;
  severity: number; // actual ÷ typ (sort key; 0 when unknown)
}

export interface ConsumptionHealth {
  rows: ConsumptionRow[]; // worst first
  counts: Record<ConsumptionState, number>;
}

export async function getFleetConsumptionHealth(opts: {
  from: Date;
  to: Date;
  projectId?: string;
}): Promise<ConsumptionHealth> {
  const issues = await prisma.fuelIssue.findMany({
    where: {
      voided: false,
      issueDate: { gte: opts.from, lte: opts.to },
      ...(opts.projectId ? { asset: { projectId: opts.projectId } } : {}),
    },
    select: {
      litres: true,
      asset: {
        select: {
          id: true,
          code: true,
          meterType: true,
          category: { select: { name: true } },
          project: { select: { name: true } },
          rentalRate: { select: { fuelConsEcon: true, fuelConsTyp: true, fuelConsHeavy: true, fuelConsBasis: true } },
        },
      },
    },
  });

  const byAsset = new Map<string, { asset: (typeof issues)[number]["asset"]; litres: number }>();
  for (const i of issues) {
    const acc = byAsset.get(i.asset.id) ?? { asset: i.asset, litres: 0 };
    acc.litres += i.litres;
    byAsset.set(i.asset.id, acc);
  }

  const rows: ConsumptionRow[] = [];
  for (const { asset, litres } of byAsset.values()) {
    const unit = asset.meterType === "KM" ? "km" : "hr";
    // The band only applies when its basis matches the vehicle's meter.
    const bandMatches = asset.rentalRate?.fuelConsBasis === unit;
    const econ = bandMatches ? asset.rentalRate?.fuelConsEcon ?? null : null;
    const typ = bandMatches ? asset.rentalRate?.fuelConsTyp ?? null : null;
    const heavy = bandMatches ? asset.rentalRate?.fuelConsHeavy ?? null : null;

    const delta = await computeWindowDelta(asset.id, asset.meterType as "KM" | "HOURS", opts.from, opts.to);
    const meterDelta = delta.delta > 0 ? delta.delta : 0;
    const actualRate = meterDelta > 0 ? litres / meterDelta : null;

    const state = classifyConsumption(actualRate, econ, typ, heavy);
    rows.push({
      assetId: asset.id,
      code: asset.code,
      categoryName: asset.category.name,
      projectName: asset.project?.name ?? null,
      meterType: asset.meterType,
      unit,
      litres,
      meterDelta,
      actualRate,
      econ,
      typ,
      heavy,
      state,
      severity: actualRate != null && typ ? actualRate / typ : 0,
    });
  }

  const rank = new Map(STATE_ORDER.map((s, i) => [s, i]));
  rows.sort((a, b) => rank.get(a.state)! - rank.get(b.state)! || b.severity - a.severity || b.litres - a.litres);

  const counts = Object.fromEntries(STATE_ORDER.map((s) => [s, 0])) as Record<ConsumptionState, number>;
  for (const r of rows) counts[r.state]++;

  return { rows, counts };
}
