import { prisma } from "../db";
import { getBillingConfig, minimumForMode } from "./config";
import { resolvePeriod, type BillingPeriod } from "./period";
import { computeRunningDelta, countWorkingDays, sumFuelForMonth } from "./usage";
import { pickRateCents, defaultModeForAsset } from "./rate";
import { computeTotals, unitLabel, basisLabel, type BillingMode, type RateBasis } from "./calc";

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

  // Dynamically resolve the project assignment for this specific billing month.
  const resolvedProject = await resolveProjectForAssetMonth(assetId, period.year, period.month, asset.project);
  const projectId = resolvedProject?.id ?? asset.projectId;
  const projectCode = resolvedProject?.code ?? asset.project?.code;
  const projectName = resolvedProject?.name ?? asset.project?.name;

  // Structural choices: preserve an admin's overrides on regenerate, else
  // derive sensible defaults from the asset.
  const billingMode: BillingMode = (existing?.billingMode as BillingMode) ||
    defaultModeForAsset(asset.meterType, asset.rentalRate.equipType);
  // Default to the Wet basis (machine + driver, no fuel baked into the rate);
  // the vehicle's actual monthly fuel total is billed as a separate line.
  const rateBasis: RateBasis = (existing?.rateBasis as RateBasis) || "w";
  const minimumUnits = existing ? existing.minimumUnits : minimumForMode(cfg, billingMode);

  const pickedRate = pickRateCents(asset.rentalRate, billingMode, rateBasis);
  const rateCents = pickedRate ?? 0;

  // Derive actual usage for the month.
  let openingMeter: number | null = null;
  let closingMeter: number | null = null;
  let actualUnits = 0;
  let derivedFromFuel = false;
  let fuelConsMidRate: number | null = null;

  // Count breakdown days in period (used for display + deduction)
  const breakdownDays = await prisma.dailyCondition.count({
    where: { assetId: asset.id, status: "BREAKDOWN", logDate: { gte: period.start, lte: period.end } },
  });

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
    asset.rentalRate.fuelConsEcon != null &&
    asset.rentalRate.fuelConsTyp != null
  ) {
    const fuelConsEcon = asset.rentalRate.fuelConsEcon;
    const fuelConsTyp = asset.rentalRate.fuelConsTyp;

    if (fuelConsTyp > 0) {
      derivedStandardUnits = fuel.litres / fuelConsTyp;
    }
    if (fuelConsEcon > 0) {
      derivedEconUnits = fuel.litres / fuelConsEcon;
    }

    const compareValues = [
      actualMeterUnits,
      derivedStandardUnits ?? 0,
      derivedEconUnits ?? 0,
    ];
    const highestVal = Math.max(...compareValues);

    if (highestVal > actualMeterUnits) {
      actualUnits = highestVal;
      derivedFromFuel = true;

      // Determine which rate yielded the highest value
      if (highestVal === derivedEconUnits) {
        fuelConsMidRate = fuelConsEcon;
      } else {
        fuelConsMidRate = fuelConsTyp;
      }
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
  const [condIds, fuelIds, readIds] = await Promise.all([
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
  ]);
  const activeAssetIds = new Set<string>([
    ...condIds.map((r) => r.assetId),
    ...fuelIds.map((r) => r.assetId),
    ...readIds.map((r) => r.assetId),
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
