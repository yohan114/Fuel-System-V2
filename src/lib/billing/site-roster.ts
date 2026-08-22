import { prisma } from "../db";
import { resolvePeriod } from "./period";
import { computeSiteSplit } from "./site-split";

// Everything a site's bill for one month does contain, and everything it
// arguably should.
//
// The two lists exist because "why is this vehicle not on my bill" is the
// question the office actually brings, and the answer differs every time: the
// machine drew fuel here but has no rate card; it is posted here but drew
// nothing; it is not in the fleet at all. Guessing between those is what makes
// people distrust the bill, so each candidate carries its own reason.

export interface RosterEntry {
  assetId: string;
  code: string;
  regNo: string | null;
  label: string | null;
  /** This site's share of the bill, in cents. Zero for a candidate. */
  amountCents: number;
  fuelLitres: number;
  /** Fuel drawn from THIS site's pumps this month. */
  fuelHereLitres: number;
  daysHere: number;
  billStatus: string | null;
  billId: string | null;
  /** Set when the machine also worked elsewhere this month. */
  alsoAt: string[];
  /** Why it is not billed here — empty when it is. */
  reason: string;
  hasRate: boolean;
  override: { id: string; action: string; reason: string | null; by: string | null } | null;
}

export interface SiteRoster {
  projectId: string;
  projectCode: string;
  projectName: string;
  periodKey: string;
  billed: RosterEntry[];
  candidates: RosterEntry[];
  billedTotalCents: number;
}

export async function buildSiteRoster(projectId: string, periodKey: string): Promise<SiteRoster | null> {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const period = resolvePeriod(y, m);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true, name: true, bulkTanks: { select: { id: true } } },
  });
  if (!project) return null;
  const tankIds = project.bulkTanks.map((t) => t.id);

  const [bills, overrides] = await Promise.all([
    prisma.bill.findMany({ where: { periodKey }, include: { lineItems: true } }),
    prisma.billingSiteOverride.findMany({
      where: { projectId, periodKey },
      include: { createdBy: { select: { name: true } } },
    }),
  ]);
  const overrideByAsset = new Map(overrides.map((o) => [o.assetId, o]));

  // Fuel this site's own pumps issued, by machine.
  const fuelHere = tankIds.length
    ? await prisma.fuelIssue.groupBy({
        by: ["assetId"],
        where: { voided: false, bulkTankId: { in: tankIds }, issueDate: { gte: period.start, lte: period.end } },
        _sum: { litres: true },
      })
    : [];
  const litresByAsset = new Map(fuelHere.map((r) => [r.assetId, r._sum.litres ?? 0]));

  // Machines posted here for any part of the month.
  const postings = await prisma.assetAssignment.findMany({
    where: {
      projectId,
      startDate: { lte: period.end },
      OR: [{ endDate: null }, { endDate: { gte: period.start } }],
    },
    select: { assetId: true },
    distinct: ["assetId"],
  });

  const billed: RosterEntry[] = [];
  const billedAssetIds = new Set<string>();

  for (const b of bills) {
    const split = computeSiteSplit(b.lineItems, b.minimumUnits);
    let amount = 0;
    let days = 0;
    const alsoAt: string[] = [];

    if (!split) {
      if (b.projectId !== projectId) continue;
      amount = b.grandTotalCents;
    } else {
      const idx = split.rows.findIndex((r) => r.projectKey === projectId);
      if (idx < 0) continue;
      const total = split.rows.reduce((s, r) => s + r.totalCents, 0);
      // Proportional to the value charged here, which is how every other view
      // of a shared bill states it.
      amount = total > 0 ? Math.round((b.grandTotalCents * split.rows[idx].totalCents) / total) : 0;
      days = split.rows[idx].days;
      for (const r of split.rows) if (r.projectKey !== projectId) alsoAt.push(r.projectName);
    }

    billedAssetIds.add(b.assetId);
    const ov = overrideByAsset.get(b.assetId);
    billed.push({
      assetId: b.assetId,
      code: b.assetCode,
      regNo: b.assetRegNo,
      label: b.assetLabel,
      amountCents: amount,
      fuelLitres: b.fuelLitres || 0,
      fuelHereLitres: litresByAsset.get(b.assetId) ?? 0,
      daysHere: days,
      billStatus: b.status,
      billId: b.id,
      alsoAt,
      reason: "",
      hasRate: b.rateCents > 0,
      override: ov ? { id: ov.id, action: ov.action, reason: ov.reason, by: ov.createdBy?.name ?? null } : null,
    });
  }
  billed.sort((a, b) => b.amountCents - a.amountCents);

  // Candidates: drew fuel from this site's pump, or was posted here, and is not
  // on the bill.
  const candidateIds = new Set<string>([
    ...litresByAsset.keys(),
    ...postings.map((p) => p.assetId),
    ...overrides.map((o) => o.assetId),
  ]);
  for (const id of billedAssetIds) candidateIds.delete(id);

  const candidateAssets = candidateIds.size
    ? await prisma.asset.findMany({
        where: { id: { in: [...candidateIds] } },
        select: {
          id: true, code: true, regNo: true, typeLabel: true, brand: true, model: true, status: true,
          billedDirect: true, billFuelOnly: true, rentalRate: { select: { id: true } },
        },
        orderBy: { code: "asc" },
      })
    : [];

  const candidates: RosterEntry[] = candidateAssets.map((a) => {
    const litres = litresByAsset.get(a.id) ?? 0;
    const ov = overrideByAsset.get(a.id);
    const reasons: string[] = [];
    if (ov?.action === "REMOVE") reasons.push("removed by hand");
    if (a.status === "DISPOSED") reasons.push("disposed");
    if (a.billedDirect) reasons.push("settled direct with the owner");
    if (!a.rentalRate && !a.billFuelOnly) reasons.push("no rate card");
    if (litres === 0) reasons.push("no fuel from this site's pump");
    return {
      assetId: a.id,
      code: a.code,
      regNo: a.regNo,
      label: [a.brand, a.model].filter(Boolean).join(" ").trim() || a.typeLabel,
      amountCents: 0,
      fuelLitres: litres,
      fuelHereLitres: litres,
      daysHere: 0,
      billStatus: null,
      billId: null,
      alsoAt: [],
      reason: reasons.join(" · ") || "not billed here",
      hasRate: !!a.rentalRate || a.billFuelOnly,
      override: ov ? { id: ov.id, action: ov.action, reason: ov.reason, by: ov.createdBy?.name ?? null } : null,
    };
  });
  // The ones with diesel behind them first — those are the real omissions.
  candidates.sort((a, b) => b.fuelHereLitres - a.fuelHereLitres || a.code.localeCompare(b.code));

  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    periodKey,
    billed,
    candidates,
    billedTotalCents: billed.reduce((s, e) => s + e.amountCents, 0),
  };
}
