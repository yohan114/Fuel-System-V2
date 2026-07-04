import { prisma } from "../db";
import { computeWindowDelta } from "../billing/usage";
import { recommendedUnits, formatVariancePct } from "../reports/recommended";

// Fuel-integrity rule engine. Signed fuel-issue records are hard to fake, so
// cross-checking them against meters, rate cards and breakdown logs surfaces
// likely under-recorded meters, off-meter running, double-draws and data
// tampering. All rules are read-only and computed on demand.

export type AnomalyType =
  | "METER_UNDER_RECORDED"
  | "CONSUMPTION_SPIKE"
  | "DUPLICATE_REFUEL"
  | "BREAKDOWN_FUELING"
  | "METER_REGRESSION";

export type Severity = "HIGH" | "MEDIUM" | "LOW";

export interface AnomalyFinding {
  assetId: string;
  assetCode: string;
  projectId: string | null;
  projectName: string | null;
  type: AnomalyType;
  severity: Severity;
  message: string;
  date?: string; // ISO day, when the finding is tied to a specific date
}

export interface AnomalyScan {
  findings: AnomalyFinding[];
  counts: { high: number; medium: number; low: number; total: number };
}

const SPIKE_RATIO_MED = 1.3; // burning ≥30% more L/unit than typical
const SPIKE_RATIO_HIGH = 1.5;

function dayKey(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function detectAnomalies(opts: {
  from: Date;
  to: Date;
  projectId?: string;
}): Promise<AnomalyScan> {
  const { from, to, projectId } = opts;

  const issues = await prisma.fuelIssue.findMany({
    where: {
      voided: false,
      issueDate: { gte: from, lte: to },
      ...(projectId ? { asset: { projectId } } : {}),
    },
    include: { asset: { include: { category: true, project: true, rentalRate: true } } },
    orderBy: { issueDate: "asc" },
  });

  // Group issues per asset.
  const byAsset = new Map<string, typeof issues>();
  for (const it of issues) {
    if (!byAsset.has(it.assetId)) byAsset.set(it.assetId, []);
    byAsset.get(it.assetId)!.push(it);
  }
  const assetIds = [...byAsset.keys()];
  if (assetIds.length === 0) {
    return { findings: [], counts: { high: 0, medium: 0, low: 0, total: 0 } };
  }

  // Batch the breakdown days and readings for all active assets in the window.
  const [breakdowns, readings] = await Promise.all([
    prisma.dailyCondition.findMany({
      where: { assetId: { in: assetIds }, status: "BREAKDOWN", logDate: { gte: from, lte: to } },
      select: { assetId: true, logDate: true },
    }),
    prisma.meterReading.findMany({
      where: { assetId: { in: assetIds }, readingDate: { gte: from, lte: to } },
      select: { assetId: true, readingType: true, value: true, readingDate: true },
      orderBy: [{ assetId: "asc" }, { readingDate: "asc" }],
    }),
  ]);

  const breakdownSet = new Set(breakdowns.map((b) => `${b.assetId}|${dayKey(b.logDate)}`));

  const findings: AnomalyFinding[] = [];

  for (const [assetId, list] of byAsset) {
    const asset = list[0].asset;
    const meterType = asset.meterType as "KM" | "HOURS";
    const fuelConsTyp = asset.rentalRate?.fuelConsTyp ?? null;
    const totalLitres = list.reduce((a, b) => a + b.litres, 0);
    const base = {
      assetId,
      assetCode: asset.code,
      projectId: asset.project?.id ?? null,
      projectName: asset.project?.name ?? null,
    };

    // Recorded meter growth over the window.
    const rd = await computeWindowDelta(assetId, meterType, from, to, asset.project?.code);
    const actualMeter = rd.delta;

    // 1. Meter under-recorded: fuel implies much more running than the meter.
    const recommended = recommendedUnits(totalLitres, fuelConsTyp);
    if (recommended != null && actualMeter >= 0) {
      const variance = (recommended - actualMeter) / Math.max(actualMeter, 1);
      if (variance >= 0.2) {
        findings.push({
          ...base,
          type: "METER_UNDER_RECORDED",
          severity: variance >= 0.5 ? "HIGH" : "MEDIUM",
          message: `Fuel implies ~${recommended.toFixed(0)} ${meterType} run but meter grew only ${actualMeter.toLocaleString()} ${meterType} (${formatVariancePct(variance)}). Possible off-meter running or under-recorded meter.`,
        });
      }
    }

    // 2. Consumption spike: burning far more L/unit than the rate card.
    if (fuelConsTyp && fuelConsTyp > 0 && actualMeter > 0) {
      const actualRate = totalLitres / actualMeter; // L per unit
      const ratio = actualRate / fuelConsTyp;
      if (ratio >= SPIKE_RATIO_MED) {
        findings.push({
          ...base,
          type: "CONSUMPTION_SPIKE",
          severity: ratio >= SPIKE_RATIO_HIGH ? "HIGH" : "MEDIUM",
          message: `Consumption ${actualRate.toFixed(2)} L/${meterType === "KM" ? "km" : "hr"} vs typical ${fuelConsTyp} (${(ratio * 100).toFixed(0)}%). Possible leak, engine fault or theft.`,
        });
      }
    }

    // 3. Duplicate / same-day refuels.
    const perDay = new Map<string, number>();
    for (const it of list) {
      const k = dayKey(it.issueDate);
      perDay.set(k, (perDay.get(k) || 0) + 1);
    }
    for (const [day, count] of perDay) {
      if (count >= 2) {
        findings.push({
          ...base,
          type: "DUPLICATE_REFUEL",
          severity: count >= 3 ? "MEDIUM" : "LOW",
          message: `${count} separate fuel issues on the same day.`,
          date: day,
        });
      }
    }

    // 4. Fueling on a day the asset was logged as broken down.
    for (const it of list) {
      if (breakdownSet.has(`${assetId}|${dayKey(it.issueDate)}`)) {
        findings.push({
          ...base,
          type: "BREAKDOWN_FUELING",
          severity: "MEDIUM",
          message: `Fuel issued (${it.litres} L) on a day the vehicle was logged BREAKDOWN.`,
          date: dayKey(it.issueDate),
        });
      }
    }
  }

  // 5. Meter regression: a reading lower than an earlier one (rollback/replacement).
  let curAsset = "";
  let curType = "";
  let maxSeen = -Infinity;
  for (const r of readings) {
    if (r.assetId !== curAsset || r.readingType !== curType) {
      curAsset = r.assetId;
      curType = r.readingType;
      maxSeen = r.value;
      continue;
    }
    if (r.value < maxSeen - 1) {
      const a = byAsset.get(r.assetId)?.[0].asset;
      findings.push({
        assetId: r.assetId,
        assetCode: a?.code ?? r.assetId,
        projectId: a?.project?.id ?? null,
        projectName: a?.project?.name ?? null,
        type: "METER_REGRESSION",
        severity: "HIGH",
        message: `Meter reading dropped to ${r.value.toLocaleString()} from a prior ${maxSeen.toLocaleString()} ${curType}. Possible rollback or unit swap.`,
        date: dayKey(r.readingDate),
      });
    } else {
      maxSeen = Math.max(maxSeen, r.value);
    }
  }

  const counts = { high: 0, medium: 0, low: 0, total: findings.length };
  for (const f of findings) {
    if (f.severity === "HIGH") counts.high++;
    else if (f.severity === "MEDIUM") counts.medium++;
    else counts.low++;
  }

  // Sort by severity (HIGH first) then asset.
  const rank: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.assetCode.localeCompare(b.assetCode));

  return { findings, counts };
}
