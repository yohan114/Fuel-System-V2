import type { Asset, Bill, Category, Prisma, Project, RentalRate } from "@prisma/client";
import { prisma } from "../db";
import { getBillingConfig, minimumForMode, type BillingConfig } from "./config";
import { resolvePeriod, type BillingPeriod } from "./period";
import {
  computeRunningDelta,
  countWorkingDays,
  computeWindowDelta,
  sumFuelForWindow,
} from "./usage";
import { pickRateCents, defaultModeForAsset, resolveRateBasis, basisFromBillingType } from "./rate";
import { computeTotals, unitLabel, basisLabel, type BillingMode, type RateBasis } from "./calc";
import { computeSegmentedTotals, type SegmentInput } from "./segmented";
import { buildBillSnapshot } from "./revisions";
import { getMonthSegments, assetHasAssignments, type MonthSegment } from "../assignments";
import { resolveBand } from "../consumption/band";
import { errorMessageOr } from "@/lib/errors";

export type GenerateStatus =
  | "created"
  | "regenerated"
  | "skipped-finalized"
  | "skipped-existing"
  | "skipped-not-here"
  | "skipped-billed-direct"
  | "no-rate";

export interface GenerateOptions {
  year: number;
  month: number;
  assetIds?: string[];
  regenerate?: boolean;
  actorId?: string | null;
  basis?: RateBasis; // force every bill in this run onto one hire basis
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
  skippedNotHere: number;
  skippedBilledDirect: number;
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

// Capture the current persisted state of a DRAFT bill as a BillRevision row
// before a regenerate overwrites it, preserving an auditable trail of every
// prior invoice figure. Runs inside the regenerate transaction, before the old
// line items are deleted, so it sees the bill exactly as it stood.
async function snapshotPriorRevision(
  tx: Prisma.TransactionClient,
  existing: Bill,
  actorId: string | null,
): Promise<void> {
  const priorLines = await tx.billLineItem.findMany({ where: { billId: existing.id } });
  const priorCount = await tx.billRevision.count({ where: { billId: existing.id } });
  await tx.billRevision.create({
    data: {
      billId: existing.id,
      revision: priorCount + 1,
      snapshotJson: JSON.stringify(buildBillSnapshot(existing, priorLines)),
      subtotalCents: existing.subtotalCents,
      grandTotalCents: existing.grandTotalCents,
      createdById: actorId,
    },
  });
}

// Generates (or regenerates a DRAFT) bill for one asset for the given period.
export async function generateBillForAsset(
  assetId: string,
  period: BillingPeriod,
  opts: { regenerate: boolean; actorId?: string | null; basis?: RateBasis }
): Promise<{ status: GenerateStatus; billId?: string }> {
  const cfg = await getBillingConfig();

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { category: true, project: true, rentalRate: true },
  });
  if (!asset) throw new Error("Asset not found");
  // Billed direct: the client settles this machine with its owner, so E&C
  // invoices neither its rental nor its fuel. Checked before the rate gate,
  // since such a machine has no reason to carry a rate card and its absence
  // would otherwise read as an oversight.
  if (asset.billedDirect) return { status: "skipped-billed-direct" };
  // A fuel-only vehicle (privately owned, E&C fuels but does not rent) bills its
  // issued fuel without a rate card, so it is allowed through the no-rate gate.
  const unpriced = !asset.rentalRate && !asset.billFuelOnly;
  const fuelOnly = asset.billFuelOnly;

  const existing = await prisma.bill.findUnique({
    where: { assetId_year_month: { assetId, year: period.year, month: period.month } },
  });

  /**
   * The machine was not at this site this month, so any bill saying it was must
   * go rather than be left behind.
   *
   * This used to return the existing bill untouched, which quietly preserved
   * whatever a previous run had decided. 86 drafts worth Rs 30.9M ended up at
   * sites no posting supported — TM-09 invoiced to CEP-03 Wadakada while its
   * only posting was Ruwanwella, still carrying a per-km mode from when it was
   * metered in KM, untouched since August because every later regeneration
   * skipped it down this path and left the stale record standing.
   *
   * Issued invoices are never deleted: one has gone to a client and is a
   * commercial fact, corrected by a credit note, not by disappearing.
   */
  async function notHere(): Promise<{ status: GenerateStatus; billId?: string }> {
    if (existing && existing.status === "DRAFT") {
      await prisma.billLineItem.deleteMany({ where: { billId: existing.id } });
      await prisma.bill.delete({ where: { id: existing.id } });
      return { status: "skipped-not-here" };
    }
    return { status: "skipped-not-here", billId: existing?.id };
  }

  if (existing && existing.status !== "DRAFT") {
    return { status: "skipped-finalized", billId: existing.id };
  }
  if (existing && !opts.regenerate) {
    return { status: "skipped-existing", billId: existing.id };
  }

  // Nothing to price it at. Reported rather than thrown so the run can tell the
  // operator which rate cards are missing.
  //
  // Deliberately checked HERE and not before `existing` is loaded. It used to
  // return early, which meant a machine that LOST its rate card — or its
  // fuel-only flag — kept the bill an earlier run had given it, at whatever
  // figure that run decided, and no later regeneration ever revisited it. The
  // same staleness notHere() was written to stop. A bill priced at nothing must
  // not be left standing.
  if (unpriced) {
    if (existing && existing.status === "DRAFT") {
      await prisma.billLineItem.deleteMany({ where: { billId: existing.id } });
      await prisma.bill.delete({ where: { id: existing.id } });
      return { status: "no-rate" };
    }
    return { status: "no-rate", billId: existing?.id };
  }

  // A month's bill needs fuel drawn in that month. The owner's rule, and it
  // narrows what came before: a machine merely posted to a site used to earn its
  // guaranteed minimum whether or not it turned a wheel, on the reasoning that
  // an idle machine is still denied to anyone else.
  //
  // In practice that billed a great deal of portable plant — generators,
  // compressors, welding sets, mixers — 26 days apiece on no evidence of use at
  // all: 38 such bills across June and July 2026, Rs 9,633,933.60. Diesel out of
  // a site's tank is the one thing that proves a machine was working there, so
  // it is now the gate.
  //
  // Deliberately checked HERE rather than by narrowing the available-fleet query
  // upstream. An asset filtered out of that query is never examined, so a bill
  // raised for it by an earlier run would survive untouched — the exact staleness
  // that left 9 bills sitting on a per-km mode months after their machines moved
  // to hours. Routing through notHere() means a regeneration both declines to
  // create the bill and removes any draft already there.
  //
  // The office can overrule this per vehicle, per site, per month — see
  // BillingSiteOverride. An ADD bills a machine the records would have passed
  // over (a small item nobody registered, plant that stood on a client's site
  // all month at their request and burnt nothing); a REMOVE declines to bill one
  // the records would have charged. Both are recorded decisions with a name
  // against them, not edits to a draft that the next regeneration erases.
  const overrides = await prisma.billingSiteOverride.findMany({
    where: { assetId, periodKey: period.periodKey },
    select: { action: true, projectId: true, reason: true },
  });
  const addedAt = overrides.find((o) => o.action === "ADD") ?? null;
  const removedSites = new Set(overrides.filter((o) => o.action === "REMOVE").map((o) => o.projectId));

  const fuelThisPeriod = await prisma.fuelIssue.count({
    where: { assetId, voided: false, issueDate: { gte: period.start, lte: period.end } },
  });
  if (fuelThisPeriod === 0 && !addedAt) return notHere();

  // Structural choices: preserve an admin's overrides on regenerate, else derive
  // sensible defaults from the asset. These do not depend on the site, so they
  // are resolved up front for both the per-site (assignment-driven) and the
  // legacy single-site billing paths.
  // How a machine is charged follows from the machine itself — an hour meter
  // bills by the hour, an odometer by the kilometre, portable plant by the day.
  //
  // This used to be frozen at whatever the bill was first created with, exactly
  // like the guaranteed minimum was. The effect was that correcting a machine's
  // meter type never reached a bill that already existed: 96 machines were sitting
  // on odometers with rate cards that only priced hours, so billing asked for a
  // per-km rate, found none, and charged Rs 0 — and flipping them to hour meters
  // changed nothing, because their drafts kept asking for kilometres. Reading it
  // fresh is what lets a meter-type correction actually take effect. A bill that
  // has left DRAFT is never regenerated, so an issued invoice cannot shift.
  const billingMode: BillingMode = defaultModeForAsset(
    asset.meterType,
    asset.rentalRate?.equipType ?? ""
  );

  // PER-SITE PATH: when the vehicle has saved assignments overlapping this month,
  // split the month into one segment per site and bill each site for its slice.
  // Fetched up front because an allocation can also carry a per-allocation
  // Dry/Wet hire type and a driver, which drive the bill basis below.
  const allSegments = await getMonthSegments(asset.id, period.start, period.end);
  // A site that has said "this was never ours" drops out of the split, and the
  // machine's other sites are billed as if it had never been posted here. If
  // that empties the month, the bill goes with it.
  const segments = removedSites.size
    ? allSegments.filter((s) => !removedSites.has(s.projectId))
    : allSegments;
  if (allSegments.length > 0 && segments.length === 0) return notHere();
  // The allocation covering the most days in the month sets the hire type and
  // driver (a manually-allocated site is billed exactly as it was allocated).
  const dominant = [...segments].sort((a, b) => b.days - a.days)[0] ?? null;
  const allocBasis: RateBasis | undefined = basisFromBillingType(dominant?.billingType);
  const driverName = dominant?.driverName ?? null;

  // Basis: a forced run-level choice (whole-month "generate as Dry/Wet") wins;
  // otherwise the allocation's Dry/Wet type → explicit draft choice → vehicle
  // default → Wet. Dry bills the dry rate with no fuel; Wet adds the fuel cost.
  const rateBasis: RateBasis = opts.basis ?? allocBasis ?? resolveRateBasis(existing?.rateBasis, asset.rentalRate?.defaultBasis);
  // A per-asset minimum working-hours floor (set on hired machines) overrides
  // the global billing.minHours for that machine's hourly bills.
  const assetMinHours = billingMode === "hourly" && asset.minBillHours != null && asset.minBillHours > 0 ? asset.minBillHours : null;
  // The guaranteed minimum is always taken from the contract terms — the
  // machine's own override if it has one, else the company standard (120 running
  // hours, 3,000 running kilometres, 26 day-hire days).
  //
  // It used to be frozen at whatever the bill was first created with, which meant
  // changing the standard did nothing to existing months: after the owner
  // confirmed 3,000 km, 104 August bills quietly kept the old minimum of 0 and
  // regenerating them changed nothing. Reading it fresh is what makes a change to
  // the terms reach every month that is still a draft, without anyone editing
  // bills by hand. A bill that has left DRAFT is never regenerated at all
  // (see the status gate above), so an issued invoice cannot move under a client.
  const minimumUnits = assetMinHours ?? minimumForMode(cfg, billingMode);

  const pickedRate = asset.rentalRate ? pickRateCents(asset.rentalRate, billingMode, rateBasis) : null;
  const rateCents = pickedRate ?? 0;

  // Count breakdown days in period (used for display + deduction).
  const breakdownDays = await prisma.dailyCondition.count({
    where: { assetId: asset.id, status: "BREAKDOWN", logDate: { gte: period.start, lte: period.end } },
  });

  // Phantom-bill guard, applied to BOTH paths.
  //
  // It used to sit below the segmented branch, which made it unreachable for
  // any machine that owns an assignment — i.e. exactly the machines that take
  // the segmented path. The result was a guaranteed monthly minimum charged to
  // machines with no fuel, no meter movement and no daily condition entry all
  // month: the assignment record was the only evidence they existed.
  //
  // A machine that has moved sites before (it owns assignments, just none that
  // prove work this month) and shows no activity at all is not billed. Machines
  // that were never assigned anywhere stay exempt, preserving back-compat.
  //
  // An ADD override is exactly the case this guard exists to catch, decided the
  // other way by someone who knows more than the records do. It is skipped.
  if (!addedAt && (billingMode === "hourly" || billingMode === "perkm")) {
    const [periodFuel, periodConditions] = await Promise.all([
      sumFuelForWindow(asset.id, period.start, period.end),
      prisma.dailyCondition.count({
        where: { assetId: asset.id, logDate: { gte: period.start, lte: period.end } },
      }),
    ]);
    if (periodFuel.litres === 0 && periodConditions === 0) {
      const meterType = billingMode === "perkm" ? "KM" : "HOURS";
      const rd = await computeRunningDelta(asset.id, meterType, period.start, period.end, undefined);
      if (rd.delta === 0 && (await assetHasAssignments(asset.id))) {
        return notHere();
      }
    }
  }

  if (segments.length > 0) {
    return persistSegmentedBill({
      asset,
      rentalRate: asset.rentalRate,
      period,
      existing,
      cfg,
      billingMode,
      rateBasis,
      driverName,
      minimumUnits,
      rateCents,
      pickedRate,
      breakdownDays,
      segments,
      fuelOnly,
      actorId: opts.actorId ?? null,
    });
  }

  // Which site owns this month, resolved from the postings alone.
  //
  // This used to fall back to `asset.projectId` — a "site pin" kept on the
  // vehicle record, a second and quietly competing source of truth. When no
  // posting covered the month the engine billed to the pin instead, which is how
  // three generators that have never drawn a litre of diesel in the life of the
  // system came to be invoiced to Wadakada. Across the fleet the pin disagreed
  // with the open posting on 98 vehicles and existed without any posting at all
  // on 34 more.
  //
  // A vehicle now belongs to a site because fuel came out of that site's tank,
  // or because somebody said so and it is recorded as a MANUAL posting. Absent
  // either, it belongs nowhere and is not billed — a machine that genuinely sits
  // on site without drawing diesel is billed by allocating it, not by guessing.
  //
  // An ADD override answers the question outright: the office has said this
  // machine belongs on that site's bill this month, which is the only evidence
  // there is for a small item nobody registered or plant that stood idle at a
  // client's request.
  const resolvedProject = addedAt
    ? await prisma.project.findUnique({ where: { id: addedAt.projectId }, select: { id: true, code: true, name: true } })
    : await resolveProjectForAssetMonth(assetId, period.year, period.month, asset.project);
  if (!resolvedProject) {
    return notHere();
  }
  // Removed from the only site the records put it on, so there is nothing left
  // to bill. An ADD is an explicit instruction and outranks a REMOVE elsewhere.
  if (!addedAt && removedSites.has(resolvedProject.id)) {
    return notHere();
  }
  const projectId = resolvedProject.id;
  const projectCode = resolvedProject.code;
  const projectName = resolvedProject.name;

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

  // Source-agnostic, exactly as the segmented path does below via
  // sumFuelForWindow: fuel follows the vehicle by date, not by which tank or
  // import batch the issue happens to be labelled with.
  const fuel = await sumFuelForWindow(asset.id, period.start, period.end);

  // Phantom-bill guard. We are on the legacy single-site path, which means the
  // vehicle had NO assignment overlapping this month, so the project was taken
  // from its (possibly stale) current pin. If the vehicle has moved between
  // sites at all (it owns assignments, just none this month) and shows no
  // measurable activity at the pinned project — no fuel issued there, no meter
  // movement / working days — there is no evidence it was on this site, so it
  // must not be billed a guaranteed minimum here. This stops a vehicle that has
  // since left (e.g. arrives at a new site next month) from appearing on its
  // old site's consolidated invoice. Truly never-assigned vehicles are exempt,
  // preserving back-compat.
  // Skipped for an ADD override, which is a person answering this exact
  // question with knowledge the records do not hold.
  if (!addedAt && fuel.litres === 0 && actualUnits === 0 && (await assetHasAssignments(asset.id))) {
    return notHere();
  }

  const actualMeterUnits = actualUnits;
  let derivedStandardUnits: number | null = null;
  let derivedEconUnits: number | null = null;

  // Units come from the standard consumption band whenever fuel was issued and
  // the band is expressed in the unit being billed. The meter is the fallback,
  // not the primary — the fleet's meter estate is demonstrably incomplete
  // (most metered bills show no movement at all), whereas every litre issued is
  // recorded. The band's basis is checked rather than assumed: an L/hr figure
  // divided into litres and labelled "kilometres" is a ~45x error.
  const bandForBilling = resolveBand(asset.rentalRate, billingMode === "perkm" ? "KM" : "HOURS");

  if (
    fuel.litres > 0 &&
    (billingMode === "hourly" || billingMode === "perkm") &&
    bandForBilling.comparable &&
    bandForBilling.typ != null &&
    bandForBilling.typ > 0
  ) {
    const fuelConsTyp = bandForBilling.typ;
    derivedStandardUnits = fuel.litres / fuelConsTyp;
    if (bandForBilling.econ && bandForBilling.econ > 0) {
      derivedEconUnits = fuel.litres / bandForBilling.econ;
    }

    actualUnits = derivedStandardUnits;
    derivedFromFuel = true;
    fuelConsMidRate = fuelConsTyp;
  }
  // Otherwise actualUnits stays as the meter delta computed above: no fuel this
  // month, no usable band, or a band the meter cannot measure. The last case
  // raises a clarify reason rather than being billed silently.

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
    fuelOnly,
  });

  const unit = unitLabel(billingMode);
  const assetLabel =
    [asset.brand, asset.model].filter(Boolean).join(" ").trim() || asset.category.name;

  // Line items: rental always (except fuel-only vehicles, which carry no rental
  // line), fuel only when actually charged (fw/w + litres, or fuel-only),
  // breakdown deduction as ADJUSTMENT when applicable.
  const lineItems: {
    kind: string;
    description: string;
    quantity: number;
    unit: string;
    unitRateCents: number;
    amountCents: number;
  }[] = [];
  if (!fuelOnly) {
    lineItems.push({
      kind: "RENTAL",
      description: pickedRate == null
        ? `Machine rental (no rate card tier for ${billingMode}/${rateBasis})`
        : `Machine rental — ${billingMode} (${rateBasis.toUpperCase()})${derivedFromFuel ? " [units from fuel]" : ""}`,
      quantity: totals.billableUnits,
      unit,
      unitRateCents: rateCents,
      amountCents: totals.rentalAmountCents,
    });
  }
  if (totals.fuelChargedCents > 0) {
    const avgPerL = fuel.litres > 0 ? Math.round(fuel.costCents / fuel.litres) : 0;
    lineItems.push({
      kind: "FUEL",
      description: fuelOnly
        ? `Fuel issued — monthly total, all sites (E&C-supplied, fuel only)`
        : `Fuel issued — monthly total, all sites (${basisLabel(rateBasis)})`,
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
    driverName,
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
    fuelConsEconSnapshot: asset.rentalRate?.fuelConsEcon ?? null,
    fuelConsTypSnapshot: asset.rentalRate?.fuelConsTyp ?? null,
    fuelConsHeavySnapshot: asset.rentalRate?.fuelConsHeavy ?? null,
  };

  const billId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await snapshotPriorRevision(tx, existing, opts.actorId ?? null);
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
  rentalRate: RentalRate | null; // null only for fuel-only vehicles (no rate card)
  period: BillingPeriod;
  existing: Bill | null;
  cfg: BillingConfig;
  billingMode: BillingMode;
  rateBasis: RateBasis;
  driverName: string | null;
  minimumUnits: number;
  rateCents: number;
  pickedRate: number | null;
  breakdownDays: number;
  segments: MonthSegment[];
  fuelOnly: boolean;
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
    billingMode, rateBasis, driverName, minimumUnits, rateCents, pickedRate, breakdownDays, segments, fuelOnly, actorId,
  } = args;

  const isMeter = billingMode === "hourly" || billingMode === "perkm";
  const meterType: "KM" | "HOURS" = billingMode === "perkm" ? "KM" : "HOURS";

  // Gather each segment's raw facts from the DB (meter movement / working days,
  // fuel). All money math then happens in the pure computeSegmentedTotals so it
  // is provable and the line items are the single source of truth.
  const segInputs: SegmentInput[] = [];
  let openingMeter: number | null = null;
  let closingMeter: number | null = null;
  let potLitres = 0;
  let potCents = 0;
  for (const seg of segments) {
    let rawUnits = 0;
    if (isMeter) {
      const rd = await computeWindowDelta(asset.id, meterType, seg.start, seg.end, seg.projectCode);
      rawUnits = rd.delta;
      if (openingMeter === null && rd.opening != null) openingMeter = rd.opening;
      if (rd.closing != null) closingMeter = rd.closing;
    } else {
      rawUnits = await countWorkingDays(asset.id, seg.start, seg.end);
    }
    const fuelSeg = await sumFuelForWindow(asset.id, seg.start, seg.end);
    potLitres += fuelSeg.litres;
    potCents += fuelSeg.costCents;
    // Each site is billed on the hire type IT was allocated on. Only when the
    // allocation left it blank does the segment fall back to the bill-level
    // basis. Without this a vehicle allocated Dry at one site and Wet at another
    // billed the whole month on whichever site held it longest — so a Wet site's
    // diesel was charged to nobody, and a Dry site's invoice printed "(W)".
    const segBasis = basisFromBillingType(seg.billingType);
    const segRate = segBasis && rentalRate
      ? pickRateCents(rentalRate, billingMode, segBasis)
      : null;

    segInputs.push({
      projectId: seg.projectId,
      projectName: seg.projectName,
      projectCode: seg.projectCode,
      days: seg.days,
      rawUnits,
      fuelLitres: fuelSeg.litres,
      fuelCostCents: fuelSeg.costCents,
      rateBasis: segBasis,
      rateCents: segRate,
      // Physical-work estimate stays pinned to the fuel burnt on-site during this
      // segment's days, so re-attributing billed fuel by source (below) never
      // moves rental between sites.
      derivLitres: fuelSeg.litres,
    });
  }

  // The month's opening comes from the first segment and its closing from the
  // last, so the pair can still end up reversed even when every segment was
  // individually coherent — a machine whose meter was replaced, or mis-keyed,
  // partway through the month. One meter cannot end a month below where it
  // started, so print neither figure rather than a pair the client can pick
  // apart. The charge is unaffected: each segment's delta was computed and
  // floored on its own.
  if (openingMeter != null && closingMeter != null && closingMeter < openingMeter) {
    openingMeter = null;
    closingMeter = null;
  }

  // Fuel stays exactly where sumFuelForWindow put it above: on the segment whose
  // DATE WINDOW contains the issue. That is the rule the owner specified — fuel
  // is charged to the site the vehicle was allocated to on the issue date — and
  // because the segments partition the month into non-overlapping day runs, every
  // issue lands in exactly one segment and none is counted twice.
  //
  // This used to be overwritten by attributeSegmentFuel(), which re-attributed
  // litres by matching FuelIssue.source — a free-text PUMP or import-batch label,
  // not a site — to project codes, then spread whatever failed to match across the
  // segments by day-share. Nine of the fourteen labels it looked for are not
  // Project codes at all, so most fuel fell through to the day-share path. Live
  // example: a machine that burnt 300 L at Marawila and 200 L at Ruwanwella billed
  // as 454.8 L and 45.2 L — the receiving site charged for a quarter of what it
  // used. Deleting the re-attribution restores the date-window answer, which was
  // correct all along.

  // Working days across the whole period feed the breakdown-deduction estimate.
  const workingDaysForBreakdown =
    breakdownDays > 0 && isMeter ? await countWorkingDays(asset.id, period.start, period.end) : 0;

  // Calendar days in the billing month — the base for prorating the guaranteed
  // minimum by how many days the vehicle was actually posted to a site.
  const daysInMonth = new Date(period.year, period.month, 0).getDate();

  const r = computeSegmentedTotals(segInputs, {
    billingMode,
    rateBasis,
    rateCents,
    pickedRate,
    minimumUnits,
    daysInMonth,
    fuelConsTyp: rentalRate?.fuelConsTyp ?? null,
    fuelConsEcon: rentalRate?.fuelConsEcon ?? null,
    ssclRate: cfg.ssclRate,
    vatRate: cfg.vatRate,
    breakdownDays,
    workingDays: workingDaysForBreakdown,
    fuelOnly,
  });

  const lineItems = r.lineItems;
  const {
    actualUnitsSum, rawMeterSum, derivedStdSum, derivedEconSum, billableSum,
    rentalSum, litresSum, fuelCostSum, breakdownDeductCents,
    subtotalCents, ssclCents, vatCents, grandTotalCents, derivedFromFuel, fuelConsMidRate,
  } = r;

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
    driverName,
    rateCents,
    openingMeter,
    closingMeter,
    actualUnits: actualUnitsSum,
    // Stored minimum is the FULL monthly guarantee (the admin-editable base and
    // the value a regenerate reads back). The availability-prorated figure that
    // was actually applied is re-derived for display from the segment days.
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
    fuelConsEconSnapshot: rentalRate?.fuelConsEcon ?? null,
    fuelConsTypSnapshot: rentalRate?.fuelConsTyp ?? null,
    fuelConsHeavySnapshot: rentalRate?.fuelConsHeavy ?? null,
  };

  const billId = await prisma.$transaction(async (tx) => {
    let id: string;
    if (existing) {
      await snapshotPriorRevision(tx, existing, actorId);
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
    skippedNotHere: 0,
    skippedBilledDirect: 0,
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

  // Deliberately NOT filtered to assets that have a rate card. A machine with
  // no rate is still part of the month's available fleet, and the per-asset
  // path below reports it as "no-rate" so the operator can see which rate
  // cards are missing. Excluding them here instead made them vanish from the
  // run entirely — with the rate table empty the generator reported nothing at
  // all, not even a count, which read as "billing is broken".
  const assets = await prisma.asset.findMany({
    where: {
      status: { not: "DISPOSED" },
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
        basis: opts.basis,
      });
      if (r.status === "created") result.created++;
      else if (r.status === "regenerated") result.regenerated++;
      else if (r.status === "skipped-finalized") result.skippedFinalized++;
      else if (r.status === "skipped-existing") result.skippedExisting++;
      else if (r.status === "skipped-not-here") result.skippedNotHere++;
      else if (r.status === "skipped-billed-direct") result.skippedBilledDirect++;
      else if (r.status === "no-rate") result.noRate++;
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: r.status, billId: r.billId });
    } catch (err: unknown) {
      result.errors.push({ assetId: a.id, assetCode: a.code, message: errorMessageOr(err, "error") });
      result.assets.push({ assetId: a.id, assetCode: a.code, assetLabel, status: "error", message: errorMessageOr(err, "error") });
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
