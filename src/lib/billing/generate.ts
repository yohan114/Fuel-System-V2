import type { Asset, Bill, Category, Project, RentalRate } from "@prisma/client";
import { prisma } from "../db";
import { getBillingConfig, minimumForMode, type BillingConfig } from "./config";
import { resolvePeriod, type BillingPeriod } from "./period";
import {
  computeRunningDelta,
  countWorkingDays,
  sumFuelForMonth,
  computeWindowDelta,
  sumFuelForWindow,
} from "./usage";
import { pickRateCents, defaultModeForAsset } from "./rate";
import { computeTotals, unitLabel, basisLabel, type BillingMode, type RateBasis } from "./calc";
import { getMonthSegments, type MonthSegment } from "../assignments";

export type GenerateStatus =
  | "created"
  | "regenerated"
  | "skipped-finalized"
  | "skipped-existing"
  | "no-rate";

export interface GenerateOptions {
  year: number;
  month: number;
  assetIds?: string[];
  regenerate?: boolean;
  actorId?: string | null;
}

export interface AssetOutcome {
  assetId: string;
  assetCode: string;
  assetLabel?: string;
  status: GenerateStatus | "error";
  message?: string;
  billId?: string;
}

export interface GenerateResult {
  periodKey: string;
  created: number;
  regenerated: number;
  skippedFinalized: number;
  skippedExisting: number;
  noRate: number;
  errors: { assetId: string; assetCode?: string; message: string }[];
  assets: AssetOutcome[];
}

async function resolveProjectForAssetMonth(
  assetId: string,
  year: number,
  month: number,
  defaultProject: { id: string; code: string; name: string } | null
): Promise<{ id: string; code: string; name: string } | null> {
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+05:30`);
  const lastDay = new Date(year, month, 0).getDate();
  const end = new Date(`${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}T23:59:59.999+05:30`);

  // 1. Check fuel issues in this month
  const firstFuel = await prisma.fuelIssue.findFirst({
    where: { assetId, issueDate: { gte: start, lte: end } },
    select: { source: true }
  });
  if (firstFuel && firstFuel.source) {
    let code = firstFuel.source;
    if (code === "BADALGAMA") code = "BADAL";
    const p = await prisma.project.findUnique({ where: { code } });
    if (p) return p;
  }

  // 2. Check meter readings in this month
  const firstReading = await prisma.meterReading.findFirst({
    where: { assetId, readingDate: { gte: start, lte: end } },
    select: { source: true }
  });
  if (firstReading && firstReading.source) {
    let code: string | null = null;
    if (firstReading.source.startsWith("DAILY_SHEET")) code = "CEP-03";
    else if (firstReading.source.startsWith("CEP-03-ABC")) code = "CEP-03-ABC";
    else if (firstReading.source.startsWith("SUMMARY")) {
      code = defaultProject?.code || null;
    }
    if (code) {
      const p = await prisma.project.findUnique({ where: { code } });
      if (p) return p;
    }
  }

  // 3. Check daily conditions in this month
  const firstCond = await prisma.dailyCondition.findFirst({
    where: { assetId, logDate: { gte: start, lte: end } }
  });
  if (firstCond) {
    const p = await prisma.project.findUnique({ where: { code: "CEP-03" } });
    if (p) return p;
  }

  return defaultProject;
}

// Generates (or regenerates a DRAFT) bill for one asset for the given period.
export async function generateBillForAsset(
  assetId: string,
  period: BillingPeriod,
  opts: { regenerate: boolean; actorId?: string | null }
): Promise<{ status: GenerateStatus; billId?: string }> {
  const cfg = await getBillingConfig();

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { category: true, project: true, rentalRate: true },
  });
  if (!asset) throw new Error("Asset not found");
  if (!asset.rentalRate) return { status: "no-rate" };

  const existing = await prisma.bill.findUnique({
    where: { assetId_year_month: { assetId, year: period.year, month: period.month } },
  });

  if (existing && existing.status !== "DRAFT") {
    return { status: "skipped-finalized", billId: existing.id };
  }
  if (existing && !opts.regenerate) {
    return { status: "skipped-existing", billId: existing.id };
  }

  // Structural choices: preserve an admin's overrides on regenerate, else derive
  // sensible defaults from the asset. These do not depend on the site, so they
  // are resolved up front for both the per-site (assignment-driven) and the
  // legacy single-site billing paths.
  const billingMode: BillingMode = (existing?.billingMode as BillingMode) ||
    defaultModeForAsset(asset.meterType, asset.rentalRate.equipType);
  // Default to the Wet basis (machine + driver, no fuel baked into the rate);
  // the vehicle's actual monthly fuel total is billed as a separate line.
  const rateBasis: RateBasis = (existing?.rateBasis as RateBasis) || "w";
  const minimumUnits = existing ? existing.minimumUnits : minimumForMode(cfg, billingMode);

  const pickedRate = pickRateCents(asset.rentalRate, billingMode, rateBasis);
  const rateCents = pickedRate ?? 0;

  // Count breakdown days in period (used for display + deduction).
  const breakdownDays = await prisma.dailyCondition.count({
    where: { assetId: asset.id, status: "BREAKDOWN", logDate: { gte: period.start, lte: period.end } },
  });

  // PER-SITE PATH: when the vehicle has saved assignments overlapping this month,
  // split the month into one segment per site and bill each site for its slice
  // (minimum prorated by days, fuel attributed by issue date). Vehicles with no
  // assignment fall through to the legacy single-site path, so previously
  // generated bills are reproduced unchanged.
  const segments = await getMonthSegments(asset.id, period.start, period.end);
  if (segments.length > 0) {
    return persistSegmentedBill({
      asset,
      rentalRate: asset.rentalRate,
      period,
      existing,
      cfg,
      billingMode,
      rateBasis,
      minimumUnits,
      rateCents,
      pickedRate,
      breakdownDays,
      segments,
      actorId: opts.actorId ?? null,
    });
  }

  // Dynamically resolve the project assignment for this specific billing month.
  const resolvedProject = await resolveProjectForAssetMonth(assetId, period.year, period.month, asset.project);
  const projectId = resolvedProject?.id ?? asset.projectId;
  const projectCode = resolvedProject?.code ?? asset.project?.code;
  const projectName = resolvedProject?.name ?? asset.project?.name;

  // Derive actual usage for the month.
  let openingMeter: number | null = null;
  let closingMeter: number | null = null;
  let actualUnits = 0;
  let derivedFromFuel = false;
  let fuelConsMidRate: number | null = null;

  if (billingMode === "hourly" || billingMode === "perkm") {
    const meterType = billingMode === "perkm" ? "KM" : "HOURS";
    const rd = await computeRunningDelta(asset.id, meterType, period.start, period.end, projectCode);
    openingMeter = rd.opening;
    closingMeter = rd.closing;
    actualUnits = rd.delta;
  } else {
    actualUnits = await countWorkingDays(asset.id, period.start, period.end);
  }

  const fuel = await sumFuelForMonth(asset.id, period.start, period.end, projectCode);

  const actualMeterUnits = actualUnits;
  let derivedStandardUnits: number | null = null;
  let derivedEconUnits: number | null = null;

  if (
    fuel.litres > 0 &&
    (billingMode === "hourly" || billingMode === "perkm") &&
    asset.rentalRate.fuelConsTyp != null &&
    asset.rentalRate.fuelConsTyp > 0
  ) {
    const fuelConsTyp = asset.rentalRate.fuelConsTyp;
    derivedStandardUnits = fuel.litres / fuelConsTyp;
    if (asset.rentalRate.fuelConsEcon && asset.rentalRate.fuelConsEcon > 0) {
      derivedEconUnits = fuel.litres / asset.rentalRate.fuelConsEcon;
    }

    const tolerance = billingMode === "hourly" ? 10 : 50;
    if (Math.abs(actualMeterUnits - derivedStandardUnits) <= tolerance) {
      actualUnits = actualMeterUnits;
    } else {
      actualUnits = derivedStandardUnits;
      derivedFromFuel = true;
      fuelConsMidRate = fuelConsTyp;
    }
  }

  if (billingMode === "hourly" && actualUnits > 720) {
    actualUnits = 720;
  }

  if (billingMode === "perkm") {
    const daysInMonth = new Date(period.year, period.month, 0).getDate();
    const maxKm = 200 * daysInMonth;
    if (actualUnits > maxKm) {
      actualUnits = maxKm;
    }
  }

  // Breakdown deduction for hourly/perkm: estimate units lost during breakdown days.
  let breakdownDeductCents = 0;
  if (breakdownDays > 0 && (billingMode === "hourly" || billingMode === "perkm")) {
    const workingDays = await countWorkingDays(asset.id, period.start, period.end);
    const totalDays = workingDays + breakdownDays;
    if (totalDays > 0 && actualUnits > 0) {
      const unitsPerDay = actualUnits / totalDays;
      const deductUnits = unitsPerDay * breakdownDays;
      breakdownDeductCents = Math.round(deductUnits * rateCents);
    }
  }

  const totals = computeTotals({
    billingMode,
    rateBasis,
    rateCents,
    actualUnits,
    minimumUnits,
    fuelLitres: fuel.litres,
    fuelCostCents: fuel.costCents,
    ssclRate: cfg.ssclRate,
    vatRate: cfg.vatRate,
  });

  const unit = unitLabel(billingMode);
  const assetLabel =
    [asset.brand, asset.model].filter(Boolean).join(" ").trim() || asset.category.name;

  // Line items: rental always, fuel only when actually charged (fw + litres),
  // breakdown deduction as ADJUSTMENT when applicable.
  const lineItems: {
    kind: string;
    description: string;
    quantity: number;
    unit: string;
    unitRateCents: number;
    amountCents: number;
  }[] = [
    {
      kind: "RENTAL",
      description: pickedRate == null
        ? `Machine rental (no rate card tier for ${billingMode}/${rateBasis})`
        : `Machine rental — ${billingMode} (${rateBasis.toUpperCase()})${derivedFromFuel ? " [units from fuel]" : ""}`,
      quantity: totals.billableUnits,
      unit,
      unitRateCents: rateCents,
      amountCents: totals.rentalAmountCents,
    },
  ];
  if (totals.fuelChargedCents > 0) {
    const avgPerL = fuel.litres > 0 ? Math.round(fuel.costCents / fuel.litres) : 0;
    lineItems.push({
      kind: "FUEL",
      description: `Fuel issued — monthly total, all sites (${basisLabel(rateBasis)})`,
      quantity: fuel.litres,
      unit: "L",
      unitRateCents: avgPerL,
      amountCents: totals.fuelChargedCents,
    });
  }
  if (breakdownDeductCents > 0) {
    lineItems.push({
      kind: "ADJUSTMENT",
      description: `Breakdown deduction (${breakdownDays} day${breakdownDays !== 1 ? "s" : ""} out of service)`,
      quantity: breakdownDays,
      unit: "day",
      unitRateCents: 0,
      amountCents: -breakdownDeductCents,
    });
  }

  const data = {
    year: period.year,
    month: period.month,
    periodKey: period.periodKey,
    periodStart: period.start,
    periodEnd: period.end,
    assetId: asset.id,
    assetCode: asset.code,
    assetRegNo: asset.regNo,
    assetLabel,
    projectId,
    projectName,
    projectCode,
    billingMode,
    rateBasis,
    rateCents,
    openingMeter,
    closingMeter,
    actualUnits,
    minimumUnits,
    billableUnits: totals.billableUnits,
    rentalAmountCents: totals.rentalAmountCents,
    fuelLitres: fuel.litres,
    fuelCostCents: fuel.costCents,
    subtotalCents: totals.subtotalCents,
    ssclRate: cfg.ssclRate,
    ssclCents: totals.ssclCents,
    vatRate: cfg.vatRate,
    vatCents: totals.vatCents,
    grandTotalCents: totals.grandTotalCents,
    generatedById: opts.actorId ?? null,
    derivedFromFuel,
    fuelConsMidRate,
    breakdownDays,
    breakdownDeductCents,
    actualMeterUnits,
    derivedStandardUnits,
    derivedEconUnits,
    fuelConsEconSnapshot: asset.rentalRate.fuelConsEcon,
    fuelConsTypSnapshot: asset.rentalRate.fuelConsTyp,
  };

  const billId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await tx.billLineItem.deleteMany({ where: { billId: existing.id } });
      await tx.bill.update({
        where: { id: existing.id },
        data: { ...data, lineItems: { create: lineItems } },
      });
      id = existing.id;
    } else {
      const created = await tx.bill.create({
        data: { ...data, lineItems: { create: lineItems } },
      });
      id = created.id;
    }
    await tx.auditLog.create({
      data: {
        actorId: opts.actorId ?? null,
        action: existing ? "UPDATE" : "CREATE",
        entity: "Bill",
        entityId: id,
        summary: `${existing ? "Regenerated" : "Generated"} bill ${period.periodKey} for ${asset.code}: grand Rs. ${(totals.grandTotalCents / 100).toLocaleString("en-LK")}`,
      },
    });
    return id;
  });

  return { status: existing ? "regenerated" : "created", billId };
}

interface SegmentedArgs {
  asset: Asset & { category: Category; project: Project | null };
  rentalRate: RentalRate;
  period: BillingPeriod;
  existing: Bill | null;
  cfg: BillingConfig;
  billingMode: BillingMode;
  rateBasis: RateBasis;
  minimumUnits: number;
  rateCents: number;
  pickedRate: number | null;
  breakdownDays: number;
  segments: MonthSegment[];
  actorId: string | null;
}

// Builds and persists a monthly bill whose charges are split per site. One
// RENTAL (and optional FUEL) line item is emitted per assignment segment; the
// bill-level totals are the sums across segments. The guaranteed minimum is
// prorated across segments by their share of assigned days, and each segment's
// fuel is summed from issues dated inside its window (fuel follows the vehicle).
async function persistSegmentedBill(args: SegmentedArgs): Promise<{ status: GenerateStatus; billId?: string }> {
  const {
    asset, rentalRate, period, existing, cfg,
    billingMode, rateBasis, minimumUnits, rateCents, pickedRate, breakdownDays, segments, actorId,
  } = args;

  const unit = unitLabel(billingMode);
  const isMeter = billingMode === "hourly" || billingMode === "perkm";
  const meterType: "KM" | "HOURS" = billingMode === "perkm" ? "KM" : "HOURS";
  const chargesFuel = rateBasis === "fw" || rateBasis === "w";
  const totalDays = segments.reduce((s, seg) => s + seg.days, 0) || 1;

  type Line = {
    kind: string; description: string; quantity: number; unit: string;
    unitRateCents: number; amountCents: number; projectId: string | null; projectName: string | null;
  };
  const rentalLines: Line[] = [];
  const fuelLines: Line[] = [];

  let actualUnitsSum = 0;
  let rawMeterSum = 0;
  let derivedStdSum = 0;
  let derivedEconSum = 0;
  let billableSum = 0;
  let rentalSum = 0;
  let litresSum = 0;
  let fuelCostSum = 0;
  let derivedFromFuel = false;
  let fuelConsMidRate: number | null = null;
  let openingMeter: number | null = null;
  let closingMeter: number | null = null;

  for (const seg of segments) {
    const minShare = minimumUnits * (seg.days / totalDays);

    let rawSeg = 0;
    let actualSeg = 0;
    if (isMeter) {
      const rd = await computeWindowDelta(asset.id, meterType, seg.start, seg.end, seg.projectCode);
      rawSeg = rd.delta;
      actualSeg = rd.delta;
      if (openingMeter === null && rd.opening != null) openingMeter = rd.opening;
      if (rd.closing != null) closingMeter = rd.closing;
    } else {
      rawSeg = await countWorkingDays(asset.id, seg.start, seg.end);
      actualSeg = rawSeg;
    }

    const fuelSeg = await sumFuelForWindow(asset.id, seg.start, seg.end);

    // Fuel-derived units: when metered movement is missing/low but fuel was
    // burnt, back the units out of the consumption rate (mirrors the legacy
    // single-site logic, applied per segment).
    let dStd: number | null = null;
    let dEcon: number | null = null;
    let segDerived = false;
    if (
      isMeter &&
      fuelSeg.litres > 0 &&
      rentalRate.fuelConsTyp != null &&
      rentalRate.fuelConsTyp > 0
    ) {
      dStd = fuelSeg.litres / rentalRate.fuelConsTyp;
      if (rentalRate.fuelConsEcon && rentalRate.fuelConsEcon > 0) {
        dEcon = fuelSeg.litres / rentalRate.fuelConsEcon;
      }

      const tolerance = billingMode === "hourly" ? 10 : 50;
      if (Math.abs(actualSeg - dStd) <= tolerance) {
        // Within tolerance - keep actual
      } else {
        // Outside tolerance - override
        actualSeg = dStd;
        segDerived = true;
        derivedFromFuel = true;
        fuelConsMidRate = rentalRate.fuelConsTyp;
      }
    }

    if (billingMode === "hourly") {
      const maxSegHours = 720 * (seg.days / totalDays);
      if (actualSeg > maxSegHours) {
        actualSeg = maxSegHours;
      }
    }

    if (billingMode === "perkm") {
      const maxSegKm = 200 * seg.days;
      if (actualSeg > maxSegKm) {
        actualSeg = maxSegKm;
      }
    }

    const billableSeg = Math.max(actualSeg, minShare);
    const rentalSeg = Math.round(billableSeg * rateCents);

    rawMeterSum += rawSeg;
    actualUnitsSum += actualSeg;
    derivedStdSum += dStd ?? 0;
    derivedEconSum += dEcon ?? 0;
    billableSum += billableSeg;
    rentalSum += rentalSeg;
    litresSum += fuelSeg.litres;
    fuelCostSum += fuelSeg.costCents;

    rentalLines.push({
      kind: "RENTAL",
      description: pickedRate == null
        ? `Machine rental — ${seg.projectCode} (no rate tier for ${billingMode}/${rateBasis})`
        : `Machine rental — ${seg.projectCode} · ${billingMode} (${rateBasis.toUpperCase()}) · ${seg.days} day${seg.days !== 1 ? "s" : ""}${segDerived ? " [units incl. fuel]" : ""}`,
      quantity: billableSeg,
      unit,
      unitRateCents: rateCents,
      amountCents: rentalSeg,
      projectId: seg.projectId,
      projectName: seg.projectName,
    });

    if (chargesFuel && fuelSeg.litres > 0) {
      fuelLines.push({
        kind: "FUEL",
        description: `Fuel issued — ${seg.projectCode} (${basisLabel(rateBasis)})`,
        quantity: fuelSeg.litres,
        unit: "L",
        unitRateCents: Math.round(fuelSeg.costCents / fuelSeg.litres),
        amountCents: fuelSeg.costCents,
        projectId: seg.projectId,
        projectName: seg.projectName,
      });
    }
  }

  // RENTAL lines first, then FUEL lines (mirrors the legacy ordering).
  const lineItems: Line[] = [...rentalLines, ...fuelLines];

  const fuelChargedCents = chargesFuel ? fuelCostSum : 0;

  // Breakdown deduction is shown as an informational line only, mirroring the
  // legacy path (which does not subtract it from the grand total either).
  let breakdownDeductCents = 0;
  if (breakdownDays > 0 && isMeter) {
    const workingDays = await countWorkingDays(asset.id, period.start, period.end);
    const totalD = workingDays + breakdownDays;
    if (totalD > 0 && actualUnitsSum > 0) {
      breakdownDeductCents = Math.round((actualUnitsSum / totalD) * breakdownDays * rateCents);
    }
  }
  if (breakdownDeductCents > 0) {
    lineItems.push({
      kind: "ADJUSTMENT",
      description: `Breakdown deduction (${breakdownDays} day${breakdownDays !== 1 ? "s" : ""} out of service)`,
      quantity: breakdownDays,
      unit: "day",
      unitRateCents: 0,
      amountCents: -breakdownDeductCents,
      projectId: null,
      projectName: null,
    });
  }

  const subtotalCents = rentalSum + fuelChargedCents;
  const ssclCents = Math.round(subtotalCents * cfg.ssclRate);
  const vatCents = Math.round((subtotalCents + ssclCents) * cfg.vatRate);
  const grandTotalCents = subtotalCents + ssclCents + vatCents;

  // Header site = the one the vehicle spent the most days at; the per-site
  // detail lives in the line items.
  const dominant = segments.reduce((a, b) => (b.days > a.days ? b : a));
  const siteCount = new Set(segments.map((s) => s.projectId)).size;
  const siteSummary = segments.map((s) => `${s.projectCode} ${s.days}d`).join(", ");
  const assetLabel =
    [asset.brand, asset.model].filter(Boolean).join(" ").trim() || asset.category.name;

  const data = {
    year: period.year,
    month: period.month,
    periodKey: period.periodKey,
    periodStart: period.start,
    periodEnd: period.end,
    assetId: asset.id,
    assetCode: asset.code,
    assetRegNo: asset.regNo,
    assetLabel,
    projectId: dominant.projectId,
    projectName: dominant.projectName,
    projectCode: dominant.projectCode,
    billingMode,
    rateBasis,
    rateCents,
    openingMeter,
    closingMeter,
    actualUnits: actualUnitsSum,
    minimumUnits,
    billableUnits: billableSum,
    rentalAmountCents: rentalSum,
    fuelLitres: litresSum,
    fuelCostCents: fuelCostSum,
    subtotalCents,
    ssclRate: cfg.ssclRate,
    ssclCents,
    vatRate: cfg.vatRate,
    vatCents,
    grandTotalCents,
    generatedById: actorId,
    derivedFromFuel,
    fuelConsMidRate,
    breakdownDays,
    breakdownDeductCents,
    actualMeterUnits: rawMeterSum,
    derivedStandardUnits: derivedStdSum > 0 ? derivedStdSum : null,
    derivedEconUnits: derivedEconSum > 0 ? derivedEconSum : null,
    fuelConsEconSnapshot: rentalRate.fuelConsEcon,
    fuelConsTypSnapshot: rentalRate.fuelConsTyp,
  };

  const billId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await tx.billLineItem.deleteMany({ where: { billId: existing.id } });
      // Stamp a one-time site-split note on multi-site bills without clobbering
      // an admin's manual notes.
      const notePatch =
        siteCount > 1 && !existing.notes ? { notes: `Multi-site month — ${siteSummary}` } : {};
      await tx.bill.update({
        where: { id: existing.id },
        data: { ...data, ...notePatch, lineItems: { create: lineItems } },
      });
      id = existing.id;
    } else {
      const created = await tx.bill.create({
        data: {
          ...data,
          notes: siteCount > 1 ? `Multi-site month — ${siteSummary}` : null,
          lineItems: { create: lineItems },
        },
      });
      id = created.id;
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: existing ? "UPDATE" : "CREATE",
        entity: "Bill",
        entityId: id,
        summary: `${existing ? "Regenerated" : "Generated"} ${siteCount > 1 ? `${siteCount}-site ` : ""}bill ${period.periodKey} for ${asset.code}: grand Rs. ${(grandTotalCents / 100).toLocaleString("en-LK")}`,
      },
    });
    return id;
  });

  return { status: existing ? "regenerated" : "created", billId };
}

// Generates bills for every eligible asset (active + has a rate card) for the
// given month. Runs sequentially to avoid SQLite write contention.
export async function generateBillsForMonth(opts: GenerateOptions): Promise<GenerateResult> {
  const period = resolvePeriod(opts.year, opts.month);
  const result: GenerateResult = {
    periodKey: period.periodKey,
    created: 0,
    regenerated: 0,
    skippedFinalized: 0,
    skippedExisting: 0,
    noRate: 0,
    errors: [],
    assets: [],
  };

  // Only bill the month's AVAILABLE fleet: a vehicle counts as available for the
  // period if the monthly sheets produced any activity for it — a working-day
  // condition, a fuel issue, or a meter reading inside the period window. This
  // mirrors the uploaded sheets, which list each site's available fleet per month.
  const [condIds, fuelIds, readIds, assignIds] = await Promise.all([
    prisma.dailyCondition.findMany({
      where: { logDate: { gte: period.start, lte: period.end } },
      select: { assetId: true }, distinct: ["assetId"],
    }),
    prisma.fuelIssue.findMany({
      where: { issueDate: { gte: period.start, lte: period.end } },
      select: { assetId: true }, distinct: ["assetId"],
    }),
    prisma.meterReading.findMany({
      where: { readingDate: { gte: period.start, lte: period.end } },
      select: { assetId: true }, distinct: ["assetId"],
    }),
    // A vehicle assigned to a site for any part of the month is billable for
    // that month — it owes at least the (prorated) minimum even with no readings.
    prisma.assetAssignment.findMany({
      where: {
        startDate: { lte: period.end },
        OR: [{ endDate: null }, { endDate: { gte: period.start } }],
      },
      select: { assetId: true }, distinct: ["assetId"],
    }),
  ]);
  const activeAssetIds = new Set<string>([
    ...condIds.map((r) => r.assetId),
    ...fuelIds.map((r) => r.assetId),
    ...readIds.map((r) => r.assetId),
    ...assignIds.map((r) => r.assetId),
  ]);

  // Respect an explicit assetIds filter if given; otherwise restrict to the
  // available fleet for the month.
  const idFilter = opts.assetIds
    ? opts.assetIds.filter((id) => activeAssetIds.has(id))
    : [...activeAssetIds];

  const assets = await prisma.asset.findMany({
    where: {
      status: { not: "DISPOSED" },
      rentalRate: { isNot: null },
      id: { in: idFilter },
    },
    select: { id: true, code: true, brand: true, model: true, regNo: true, category: { select: { name: true } } },
    orderBy: { code: "asc" },
  });

  for (const a of assets) {
    const assetLabel = [a.brand, a.model].filter(Boolean).join(" ").trim() || a.category.name;
    try {
      const r = await generateBillForAsset(a.id, period, {
        regenerate: opts.regenerate ?? false,
        actorId: opts.actorId,
      });
      if (r.status === "created") result.created++;
      else if (r.status === "regenerated") result.regenerated++;
      else if (r.status === "skipped-finalized") result.skippedFinalized++;
      else if (r.status === "skipped-existing") result.skippedExisting++;
      else if (r.status === "no-rate") result.noRate++;
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: r.status, billId: r.billId });
    } catch (err: any) {
      result.errors.push({ assetId: a.id, assetCode: a.code, message: err?.message || "error" });
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: "error", message: err?.message || "error" });
    }
  }

  return result;
}

// Flips ISSUED bills whose dueDate has passed to OVERDUE. Returns the count.
export async function sweepOverdueBills(now: Date = new Date()): Promise<number> {
  const res = await prisma.bill.updateMany({
    where: { status: "ISSUED", dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });
  return res.count;
}
