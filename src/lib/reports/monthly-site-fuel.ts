import { prisma } from "../db";
import { resolvePeriod } from "../billing/period";
import { indexAssignments, assignedSiteOn, type SiteSpan } from "../fuel/site-attribution";
import { colomboDayKey } from "../colombo-date";

// Monthly fuel-issue summary, site by site, in which EVERY issue of the month
// is attributed to exactly one site — the site totals always add back up to the
// month total.
//
// This is deliberately not aggregateFuelData/getSiteOverview, which bucket an
// issue by its asset's *current* project pointer. That pointer moves with the
// machine, so last month's fuel silently follows a machine to its new site and
// a closed month's numbers change after the fact. Here attribution is resolved
// against the state on the day of the issue.
//
// The cascade, most authoritative first:
//   1. "posted"  — the site the machine was assigned to on the issue date.
//   2. "tank"    — the site that owns the tank the fuel was drawn from, used
//                  only when the machine had no posting covering that day.
//                  Recorded fact rather than inference.
//   3. "current" — the machine's current site pointer; last resort.
// Anything that somehow escapes all three lands in "unassigned" and is counted
// openly rather than dropped, so a shortfall is visible instead of silent.

export type AttributionRule = "posted" | "tank" | "current" | "unassigned";

/**
 * Which question the sheet answers.
 *
 * "pump"   — group every issue under the site whose tank it came out of, and
 *            never mind where the machine is allocated. This is what a site's
 *            own storekeeper counts: their register records what left their
 *            pump, to whoever drove up to it.
 *
 * "billed" — group every issue under the site that pays for it, resolved
 *            against the machine's posting on the day. This is what an invoice
 *            is built from, and it is the only basis under which a machine that
 *            visits another site's pump still costs its own project money.
 *
 * They differ by exactly the traffic between sites. For Galagedara in August
 * 2026: 21,640 L left its pump, 840 L of that went into visiting machines and
 * was billed elsewhere, 250 L came back the other way, and 21,050 L was billed.
 * Neither figure is more correct — they are answers to different questions, and
 * quoting one when the other was asked for is what makes them look wrong.
 */
export type ReportBasis = "pump" | "billed";

export interface AttributionInput {
  assetId: string;
  issueDate: Date;
  bulkTankId: string | null;
  assetProjectId: string | null;
}

export interface Attribution {
  projectId: string | null;
  rule: AttributionRule;
}

// Pure: no database access, so the rule order is unit-testable on its own.
export function attributeIssue(
  assignmentIndex: Map<string, SiteSpan[]>,
  tankProject: Map<string, string | null>,
  input: AttributionInput,
): Attribution {
  const posted = assignedSiteOn(assignmentIndex, input.assetId, input.issueDate);
  if (posted) return { projectId: posted, rule: "posted" };

  if (input.bulkTankId) {
    const viaTank = tankProject.get(input.bulkTankId);
    if (viaTank) return { projectId: viaTank, rule: "tank" };
  }

  if (input.assetProjectId) return { projectId: input.assetProjectId, rule: "current" };

  return { projectId: null, rule: "unassigned" };
}

/** One fuel issue, as it appears under its machine. */
export interface MachineIssueRow {
  id: string;
  /** Colombo calendar day, YYYY-MM-DD, via the shared colomboDayKey — an
   *  imported row sits at 18:30Z the evening before, so the host's zone would
   *  file the whole of a site's 4 August work under the 3rd. */
  day: string;
  litres: number;
  costCents: number;
  pricePerLitre: number;
  meterReading: number | null;
  readingType: string | null;
  /** Site code of the tank the fuel physically came from, or null for a workshop issue. */
  tankSite: string | null;
  tankName: string | null;
  /** Which rule attributed THIS issue to the site it is filed under. */
  rule: AttributionRule;
  issuePerson: string | null;
  source: string | null;
}

export interface MachineRow {
  assetId: string;
  /** The E&C fleet number — what the yard calls it. */
  code: string;
  /** The number plate. Different machines share plates in this fleet, and some
   *  machines have none, so this is shown beside the code rather than instead. */
  regNo: string | null;
  label: string;
  litres: number;
  costCents: number;
  issueCount: number;
  postedIssues: number; // how many of this machine's issues came from a posting
  /** Every issue behind the totals above, oldest first. Carried so the screen can
   *  open a machine without a second round trip and the sheet can list them. */
  issues: MachineIssueRow[];
}

export interface SiteRow {
  projectId: string; // UNASSIGNED_ID when no site could be resolved
  code: string;
  name: string;
  /** Fuel BILLED to this site: every issue attributed here by the cascade.
   *  These are the figures that add back up to the month total. */
  litres: number;
  costCents: number;
  issueCount: number;
  machineCount: number;
  machines: MachineRow[];
  byRule: Record<AttributionRule, number>;
  /** Fuel that came OUT OF THIS SITE'S PUMP, whoever it was billed to.
   *
   *  A different question from the one above, and the one a storekeeper asks:
   *  their own tank register and monthly consumption report count what left the
   *  pump. A visiting machine's fill appears here but is billed to its own site,
   *  and one of this site's machines filling elsewhere is billed here but does
   *  not appear here. For Galagedara in August the two read 21,640 and 21,050 —
   *  840 L out to visitors, 250 L back from its own machines fuelling away.
   *
   *  These deliberately do NOT add up to the month total, because a site with no
   *  tank has none and fuel can be counted at one site and billed at another.
   *  Never sum this column and expect the month. */
  pumpLitres: number;
  pumpCostCents: number;
  pumpIssueCount: number;
  /** Fuel BILLED to this site, computed on both bases so a row can always show
   *  its counterpart. On the "billed" basis this equals `litres`; on the "pump"
   *  basis it is the figure the invoice would use instead. */
  billedLitres: number;
  billedIssueCount: number;
}

export interface MonthlySiteFuelReport {
  period: { year: number; month: number; periodKey: string; label: string; start: Date; end: Date };
  /** Which question these figures answer. Every caller that prints a total
   *  should print this too — the same site is 21,640 L on one basis and
   *  21,050 L on the other, and a number without its basis is an argument. */
  basis: ReportBasis;
  sites: SiteRow[];
  totals: {
    litres: number; costCents: number; issueCount: number; machineCount: number;
    /** Fuel that left a site pump anywhere this month. Lower than `litres` by
     *  whatever was issued with no tank attached — a workshop entry, say — so
     *  the two are not expected to agree. */
    pumpLitres: number;
  };
  byRule: Record<AttributionRule, number>;
  voidedExcluded: number;
  // Proof the sheet balances: site rows re-summed vs the month's own total.
  reconciliation: { issuesInMonth: number; issuesOnSheet: number; litresInMonth: number; litresOnSheet: number; balanced: boolean };
}

export const UNASSIGNED_ID = "unassigned";

// Excel tab names are far stricter than site names: 31 characters, no
// : \ / ? * [ ], not blank, and unique within the workbook. A site called
// "CEP-03 A,B & C Package" or two sites sharing a 31-character prefix would
// otherwise produce a corrupt file or a silently dropped tab.
export function excelSheetName(desired: string, taken: Set<string>): string {
  let base = (desired || "Site").replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  if (!base) base = "Site";
  if (!taken.has(base.toLowerCase())) { taken.add(base.toLowerCase()); return base; }
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) { taken.add(candidate.toLowerCase()); return candidate; }
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function buildMonthlySiteFuel(opts: {
  year: number;
  month: number;
  projectId?: string;
  /** Defaults to "pump": a site sheet is read by the site, and the site counts
   *  its pump. Pass "billed" for the invoicing view. */
  basis?: ReportBasis;
}): Promise<MonthlySiteFuelReport> {
  const period = resolvePeriod(opts.year, opts.month);
  const basis: ReportBasis = opts.basis ?? "pump";

  const [issues, voidedCount, spans, tanks, projects] = await Promise.all([
    prisma.fuelIssue.findMany({
      where: { voided: false, issueDate: { gte: period.start, lte: period.end } },
      // Never select photoData — the BLOB would be pulled for every issue of
      // the month to build a summary that does not show pictures.
      select: {
        id: true,
        litres: true,
        totalCost: true,
        pricePerLitre: true,
        issueDate: true,
        bulkTankId: true,
        meterReading: true,
        readingType: true,
        issuePerson: true,
        source: true,
        asset: { select: { id: true, code: true, regNo: true, brand: true, model: true, projectId: true, category: { select: { name: true } } } },
      },
      orderBy: { issueDate: "asc" },
    }),
    prisma.fuelIssue.count({ where: { voided: true, issueDate: { gte: period.start, lte: period.end } } }),
    // Only spans that can touch the month; assignmentIndex resolves by day.
    prisma.assetAssignment.findMany({
      where: { startDate: { lte: period.end }, OR: [{ endDate: null }, { endDate: { gte: period.start } }] },
      select: { assetId: true, projectId: true, startDate: true, endDate: true },
    }),
    prisma.bulkTank.findMany({ select: { id: true, name: true, projectId: true } }),
    prisma.project.findMany({ select: { id: true, code: true, name: true } }),
  ]);

  const assignmentIndex = indexAssignments(spans);
  const tankProject = new Map(tanks.map((t) => [t.id, t.projectId]));
  const tankById = new Map(tanks.map((t) => [t.id, t]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  // The tank a machine fuelled AT is often not the site it is billed to — a
  // visiting machine fills wherever it happens to be. Showing both is the point
  // of opening a row, so the pump is resolved per issue rather than per site.

  const emptyRules = (): Record<AttributionRule, number> => ({ posted: 0, tank: 0, current: 0, unassigned: 0 });
  const byRule = emptyRules();
  const acc = new Map<string, SiteRow & { machineMap: Map<string, MachineRow> }>();

  const ensureSite = (projectId: string | null): SiteRow & { machineMap: Map<string, MachineRow> } => {
    const id = projectId ?? UNASSIGNED_ID;
    let row = acc.get(id);
    if (!row) {
      const p = projectId ? projectById.get(projectId) : undefined;
      row = {
        projectId: id,
        code: p?.code ?? "—",
        name: p?.name ?? "Unassigned",
        litres: 0, costCents: 0, issueCount: 0, machineCount: 0,
        machines: [], byRule: emptyRules(), machineMap: new Map(),
        pumpLitres: 0, pumpCostCents: 0, pumpIssueCount: 0,
        billedLitres: 0, billedIssueCount: 0,
      };
      acc.set(id, row);
    }
    return row;
  };

  // Counted independently of attribution: this is where the fuel physically came
  // out, which is what a site's own tank register records. Accumulated for every
  // issue including ones a site filter later drops, then filtered alongside.
  const pumpAcc = new Map<string, { litres: number; costCents: number; issueCount: number }>();
  // The other basis, tallied alongside, so every row can show both figures
  // whichever one it is sorted and totalled by.
  const billedAcc = new Map<string, { litres: number; issueCount: number }>();
  for (const issue of issues) {
    const pumpProjectId = issue.bulkTankId ? tankProject.get(issue.bulkTankId) ?? null : null;
    if (pumpProjectId && (!opts.projectId || pumpProjectId === opts.projectId)) {
      let p = pumpAcc.get(pumpProjectId);
      if (!p) { p = { litres: 0, costCents: 0, issueCount: 0 }; pumpAcc.set(pumpProjectId, p); }
      p.litres += issue.litres;
      p.costCents += issue.totalCost;
      p.issueCount++;
    }

    const billedTo = attributeIssue(assignmentIndex, tankProject, {
      assetId: issue.asset.id,
      issueDate: issue.issueDate,
      bulkTankId: issue.bulkTankId,
      assetProjectId: issue.asset.projectId,
    }).projectId ?? UNASSIGNED_ID;
    if (!opts.projectId || billedTo === opts.projectId) {
      let b = billedAcc.get(billedTo);
      if (!b) { b = { litres: 0, issueCount: 0 }; billedAcc.set(billedTo, b); }
      b.litres += issue.litres;
      b.issueCount++;
    }

    // On the pump basis the tank IS the answer — no cascade, no posting lookup,
    // and a machine allocated somewhere else still counts against the pump that
    // served it. An issue with no tank has no pump and falls to unassigned
    // rather than being quietly routed somewhere by a fallback.
    const { projectId, rule } = basis === "pump"
      ? { projectId: pumpProjectId, rule: (pumpProjectId ? "tank" : "unassigned") as AttributionRule }
      : attributeIssue(assignmentIndex, tankProject, {
          assetId: issue.asset.id,
          issueDate: issue.issueDate,
          bulkTankId: issue.bulkTankId,
          assetProjectId: issue.asset.projectId,
        });

    // A site filter is applied after attribution — filtering the query by the
    // asset's project would reintroduce the current-pointer bug this report exists to avoid.
    if (opts.projectId && (projectId ?? UNASSIGNED_ID) !== opts.projectId) continue;

    byRule[rule]++;
    const site = ensureSite(projectId);
    site.litres += issue.litres;
    site.costCents += issue.totalCost;
    site.issueCount++;
    site.byRule[rule]++;

    const a = issue.asset;
    let m = site.machineMap.get(a.id);
    if (!m) {
      m = {
        assetId: a.id,
        code: a.code,
        regNo: a.regNo,
        label: [a.brand, a.model].filter(Boolean).join(" ").trim() || a.category.name,
        litres: 0, costCents: 0, issueCount: 0, postedIssues: 0, issues: [],
      };
      site.machineMap.set(a.id, m);
    }
    m.litres += issue.litres;
    m.costCents += issue.totalCost;
    m.issueCount++;
    if (rule === "posted") m.postedIssues++;

    const tank = issue.bulkTankId ? tankById.get(issue.bulkTankId) : undefined;
    const tankProjectId = tank ? tank.projectId : null;
    m.issues.push({
      id: issue.id,
      day: colomboDayKey(issue.issueDate),
      litres: issue.litres,
      costCents: issue.totalCost,
      pricePerLitre: issue.pricePerLitre,
      meterReading: issue.meterReading,
      readingType: issue.readingType,
      tankSite: tankProjectId ? projectById.get(tankProjectId)?.code ?? null : null,
      tankName: tank ? tank.name : null,
      rule,
      issuePerson: issue.issuePerson,
      source: issue.source,
    });
  }

  const sites: SiteRow[] = [...acc.values()].map((s) => {
    const machines = [...s.machineMap.values()]
      .map((m) => ({
        ...m,
        litres: round2(m.litres),
        // Oldest first: a machine's month reads as a sequence, and its meter
        // readings only make sense in date order.
        issues: [...m.issues].sort((x, y) => x.day.localeCompare(y.day) || x.id.localeCompare(y.id)),
      }))
      .sort((x, y) => y.litres - x.litres || x.code.localeCompare(y.code));
    const pump = pumpAcc.get(s.projectId);
    return {
      projectId: s.projectId, code: s.code, name: s.name,
      litres: round2(s.litres), costCents: s.costCents, issueCount: s.issueCount,
      machineCount: machines.length, machines, byRule: s.byRule,
      pumpLitres: round2(pump?.litres ?? 0),
      pumpCostCents: pump?.costCents ?? 0,
      pumpIssueCount: pump?.issueCount ?? 0,
      billedLitres: round2(billedAcc.get(s.projectId)?.litres ?? 0),
      billedIssueCount: billedAcc.get(s.projectId)?.issueCount ?? 0,
    };
  });

  // A site whose pump issued fuel that was ALL billed elsewhere has no
  // attributed row and would otherwise vanish from a sheet that is supposed to
  // show what left its tank. PALO is exactly that in August 2026: one 30 L fill
  // to a machine posted to another site.
  for (const [projectId, pump] of pumpAcc) {
    if (sites.some((s) => s.projectId === projectId)) continue;
    const p = projectById.get(projectId);
    sites.push({
      projectId, code: p?.code ?? "—", name: p?.name ?? "—",
      litres: 0, costCents: 0, issueCount: 0, machineCount: 0,
      machines: [], byRule: emptyRules(),
      pumpLitres: round2(pump.litres), pumpCostCents: pump.costCents, pumpIssueCount: pump.issueCount,
      billedLitres: round2(billedAcc.get(projectId)?.litres ?? 0),
      billedIssueCount: billedAcc.get(projectId)?.issueCount ?? 0,
    });
  }
  // Biggest consumer first; the unassigned bucket always sits last so it reads as an exception.
  sites.sort((x, y) =>
    (x.projectId === UNASSIGNED_ID ? 1 : 0) - (y.projectId === UNASSIGNED_ID ? 1 : 0) ||
    y.litres - x.litres || x.name.localeCompare(y.name));

  const totals = sites.reduce(
    (t, s) => {
      t.litres = round2(t.litres + s.litres);
      t.costCents += s.costCents;
      t.issueCount += s.issueCount;
      // Safe to sum here, unlike per-site comparisons: each issue belongs to at
      // most one pump, so no litre is counted twice across sites.
      t.pumpLitres = round2(t.pumpLitres + s.pumpLitres);
      return t;
    },
    { litres: 0, costCents: 0, issueCount: 0, machineCount: 0, pumpLitres: 0 },
  );
  totals.machineCount = new Set(sites.flatMap((s) => s.machines.map((m) => m.assetId))).size;

  const litresInMonth = round2(issues.reduce((s, i) => s + i.litres, 0));
  const reconciliation = {
    issuesInMonth: issues.length,
    issuesOnSheet: totals.issueCount,
    litresInMonth,
    litresOnSheet: totals.litres,
    // Only meaningful without a site filter; a filtered sheet is a subset by design.
    balanced: opts.projectId
      ? true
      : issues.length === totals.issueCount && Math.abs(litresInMonth - totals.litres) < 0.01,
  };

  const label = new Date(period.year, period.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  return {
    period: { year: period.year, month: period.month, periodKey: period.periodKey, label, start: period.start, end: period.end },
    basis, sites, totals, byRule, voidedExcluded: voidedCount, reconciliation,
  };
}
