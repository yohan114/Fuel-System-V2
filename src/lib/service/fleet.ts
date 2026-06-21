import { prisma } from "../db";
import { computeServiceStatus, type ServiceStatus, type ServiceState } from "./compute";

export interface FleetService {
  rows: ServiceStatus[];
  counts: { overdue: number; dueSoon: number; ok: number; unknown: number; tracked: number };
}

// Service status across the in-service fleet (active assets with any reading or
// fuel issue). Bounded to in-service vehicles so the per-asset computation stays
// proportional to the working fleet.
export async function getFleetServiceStatus(opts: { asOf?: Date; projectId?: string } = {}): Promise<FleetService> {
  const asOf = opts.asOf ?? new Date();

  const active = await prisma.asset.findMany({
    where: { status: "ACTIVE", ...(opts.projectId ? { projectId: opts.projectId } : {}) },
    select: { id: true },
  });
  const activeIds = new Set(active.map((a) => a.id));
  if (activeIds.size === 0) return { rows: [], counts: { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, tracked: 0 } };

  const [readIds, fuelIds] = await Promise.all([
    prisma.meterReading.findMany({ where: { assetId: { in: [...activeIds] } }, select: { assetId: true }, distinct: ["assetId"] }),
    prisma.fuelIssue.findMany({ where: { assetId: { in: [...activeIds] }, voided: false }, select: { assetId: true }, distinct: ["assetId"] }),
  ]);
  const inService = new Set<string>(
    [...readIds.map((r) => r.assetId), ...fuelIds.map((r) => r.assetId)].filter((id) => activeIds.has(id))
  );

  const rows: ServiceStatus[] = [];
  for (const id of inService) {
    const s = await computeServiceStatus(id, asOf);
    if (s) rows.push(s);
  }

  const order: Record<ServiceState, number> = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNKNOWN: 3 };
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.remaining ?? 1e9) - (b.remaining ?? 1e9));

  const counts = { overdue: 0, dueSoon: 0, ok: 0, unknown: 0, tracked: rows.length };
  for (const r of rows) {
    if (r.state === "OVERDUE") counts.overdue++;
    else if (r.state === "DUE_SOON") counts.dueSoon++;
    else if (r.state === "OK") counts.ok++;
    else counts.unknown++;
  }

  return { rows, counts };
}
