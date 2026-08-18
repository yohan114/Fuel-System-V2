// Per-vehicle actual fuel consumption over time, measured fill-to-fill.
//
// WHY FILL-TO-FILL AND NOT MONTHLY: meter capture only ramped up in June 2026
// (a few dozen readings a month before, several hundred after). Bucketing by
// month collapses the fleet to ~66 vehicles with a usable line; pairing
// consecutive fuel issues that carry a reading gives ~106. It also reads
// FuelIssue, which carries ~700 readings that were never mirrored into
// MeterReading and which has an index on (assetId, issueDate).
//
// WHY THIS IS DELIBERATELY NOT THE BILLING NUMBER: once billing derives units
// from litres / fuelConsTyp, the implied consumption of a bill is fuelConsTyp
// by construction, so checking a bill against the standard would read 1.00 for
// every vehicle forever. The only independent measurement of work is the meter,
// so this series is litres / meter-delta and never touches Bill.
//
// WHAT A SINGLE INTERVAL IS NOT: this fleet issues partial bowser loads, so
// litres-in-window and distance-in-window are not the same physical quantity
// for one pair of readings. One truck shows a 10x spread across eleven
// one-day intervals. A verdict therefore needs several intervals, and small
// intervals are dropped entirely — a 30 L fill across a 23 km reading gap
// reads as 0.77 km/L and would otherwise top the repair-candidate list.

import { prisma } from "../db";
import {
  type ConsBasis,
  MIN_INTERVAL_DELTA,
  MIN_INTERVALS_FOR_VERDICT,
  consBasisForMeter,
  isPlausibleRate,
  resolveBand,
  type ResolvedBand,
} from "../consumption/band";
import { classifyConsumption, type ConsumptionState } from "./consumption";

export interface RawAnchor {
  id: string;
  issueDate: Date;
  litres: number;
  meterReading: number | null;
  readingType: string | null;
  createdAt: Date;
}

export interface ConsumptionPoint {
  /** ISO date of the closing fill of this interval. */
  date: string;
  /** Litres burned across the interval (every issue in the window, metered or not). */
  litres: number;
  /** Meter movement across the interval, in hours or km. */
  meterDelta: number;
  /** Storage units: L/hr or L/km. Higher is worse on both bases. */
  rate: number;
  openingMeter: number;
  closingMeter: number;
  days: number;
}

export type SeriesShape = "line" | "single" | "empty";

export interface AssetConsumptionSeries {
  assetId: string;
  code: string;
  meterType: string;
  basis: ConsBasis;
  band: ResolvedBand;
  points: ConsumptionPoint[];
  shape: SeriesShape;
  /** Median of the usable interval rates — the figure to compare against the band. */
  actualRate: number | null;
  /** Verdict, only once there are enough intervals to mean something. */
  state: ConsumptionState | null;
  /** actualRate / typ. 0 when unknown. Sort key for "worst first". */
  severity: number;
  /** Why there is no line, in words fit for the screen. */
  emptyReason: string | null;
  totalLitres: number;
  meteredIssues: number;
  rejected: { nonPositive: number; tooSmall: number; implausible: number; badReading: number };
}

const MS_PER_DAY = 86_400_000;

// A reading more than twice the previous one on the same machine is a
// transcription error (a digit inserted), not a month's work. Left in the data
// it produces one absurd positive interval and one negative.
const READING_JUMP_FACTOR = 2;

function isoDay(d: Date): string {
  // Issues are stored at Colombo midnight (18:30Z the previous day), so the
  // calendar day must be read in Colombo time, not UTC.
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Pure core: turn one asset's fuel issues into usable consumption intervals.
 *
 * `anchors` must be every non-voided issue for the asset. Those carrying a
 * meter reading of the right type become interval boundaries; the rest still
 * contribute their litres to whichever interval they fall in.
 */
export function buildIntervals(
  anchors: RawAnchor[],
  meterType: string,
  basis: ConsBasis
): { points: ConsumptionPoint[]; rejected: AssetConsumptionSeries["rejected"]; meteredIssues: number } {
  const rejected = { nonPositive: 0, tooSmall: 0, implausible: 0, badReading: 0 };

  // Deterministic order. 10,963 of 13,142 issues share the exact timestamp
  // 18:30:00Z, so issueDate alone does not order them.
  const sorted = [...anchors].sort(
    (a, b) =>
      a.issueDate.getTime() - b.issueDate.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );

  // Collapse same-day metered issues to one boundary, otherwise an interval can
  // have a zero-length window: its litres land in no interval at all.
  const dayAnchor = new Map<string, { meter: number; date: Date }>();
  for (const a of sorted) {
    if (a.meterReading == null || a.meterReading <= 0) continue;
    // A reading of the wrong type is on a different scale — an odometer value
    // cannot be differenced against an hour meter.
    if (a.readingType != null && a.readingType !== meterType) continue;
    const day = isoDay(a.issueDate);
    const prev = dayAnchor.get(day);
    if (!prev || a.meterReading > prev.meter) dayAnchor.set(day, { meter: a.meterReading, date: a.issueDate });
  }

  const boundaries = [...dayAnchor.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const meteredIssues = boundaries.length;
  if (boundaries.length < 2) return { points: [], rejected, meteredIssues };

  // Litres per calendar day, so a window can be summed without rescanning.
  const litresByDay = new Map<string, number>();
  for (const a of sorted) {
    const day = isoDay(a.issueDate);
    litresByDay.set(day, (litresByDay.get(day) ?? 0) + a.litres);
  }
  const days = [...litresByDay.keys()].sort();

  const points: ConsumptionPoint[] = [];
  const floor = MIN_INTERVAL_DELTA[basis];

  // Accumulator for merging. A single short hop between two fills is mostly
  // noise — a partial bowser load does not correspond to the distance covered —
  // but consecutive hops summed together do measure real consumption. So rather
  // than discarding short intervals and losing their litres, they are carried
  // forward until enough meter movement has accumulated to mean something.
  let open: { day: string; meter: number; date: Date } | null = null;
  let accLitres = 0;

  for (let i = 1; i < boundaries.length; i++) {
    const prev = boundaries[i - 1];
    const cur = boundaries[i];
    if (!open) open = prev;

    // Litres in (prev.day, cur.day] — the fills that went in over this movement.
    let stepLitres = 0;
    for (const d of days) {
      if (d > prev.day && d <= cur.day) stepLitres += litresByDay.get(d)!;
    }

    // A transcription typo (a digit inserted) before differencing.
    if (prev.meter > 0 && cur.meter > prev.meter * READING_JUMP_FACTOR) {
      rejected.badReading++;
      open = null;
      accLitres = 0;
      continue;
    }

    if (cur.meter <= prev.meter) {
      // Meter replacement or a backwards entry: the scale changed, so anything
      // accumulated so far cannot be differenced against what follows.
      rejected.nonPositive++;
      open = null;
      accLitres = 0;
      continue;
    }

    accLitres += stepLitres;
    const meterDelta = cur.meter - open.meter;

    if (meterDelta < floor) {
      // Not yet enough movement to measure — keep accumulating.
      rejected.tooSmall++;
      continue;
    }

    if (accLitres <= 0) {
      open = null;
      accLitres = 0;
      continue;
    }

    const rate = accLitres / meterDelta;
    if (!isPlausibleRate(rate, basis)) {
      rejected.implausible++;
      open = null;
      accLitres = 0;
      continue;
    }

    points.push({
      date: cur.day,
      litres: Math.round(accLitres * 100) / 100,
      meterDelta: Math.round(meterDelta * 100) / 100,
      rate,
      openingMeter: open.meter,
      closingMeter: cur.meter,
      days: Math.max(1, Math.round((cur.date.getTime() - open.date.getTime()) / MS_PER_DAY)),
    });
    open = null;
    accLitres = 0;
  }

  return { points, rejected, meteredIssues };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function emptyReasonFor(meteredIssues: number, totalLitres: number, pointCount: number): string | null {
  if (pointCount > 0) return null;
  if (totalLitres === 0) return "No fuel issued yet.";
  if (meteredIssues === 0) return "Fuel issued, but the meter has never been read at a fill.";
  if (meteredIssues === 1) return "Only one meter reading — two are needed to measure consumption.";
  return "Meter readings exist but none form a usable interval (no movement, or the movement is too small to measure).";
}

/**
 * Build the series for every asset (or a subset) in a fixed number of queries,
 * regardless of fleet size. getFleetConsumptionHealth awaits a meter query per
 * asset inside a loop; this does not.
 */
export async function getConsumptionSeries(opts?: {
  assetIds?: string[];
  from?: Date;
  to?: Date;
}): Promise<Map<string, AssetConsumptionSeries>> {
  const assets = await prisma.asset.findMany({
    where: opts?.assetIds ? { id: { in: opts.assetIds } } : undefined,
    select: {
      id: true,
      code: true,
      meterType: true,
      rentalRate: {
        select: { fuelConsEcon: true, fuelConsTyp: true, fuelConsHeavy: true, fuelConsBasis: true },
      },
    },
  });

  const issues = await prisma.fuelIssue.findMany({
    where: {
      voided: false,
      ...(opts?.assetIds ? { assetId: { in: opts.assetIds } } : {}),
      ...(opts?.from || opts?.to
        ? { issueDate: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    select: {
      id: true,
      assetId: true,
      issueDate: true,
      litres: true,
      meterReading: true,
      readingType: true,
      createdAt: true,
    },
    orderBy: { issueDate: "asc" },
  });

  const byAsset = new Map<string, RawAnchor[]>();
  for (const i of issues) {
    const list = byAsset.get(i.assetId);
    if (list) list.push(i);
    else byAsset.set(i.assetId, [i]);
  }

  const out = new Map<string, AssetConsumptionSeries>();
  for (const asset of assets) {
    const anchors = byAsset.get(asset.id) ?? [];
    const basis = consBasisForMeter(asset.meterType);
    const band = resolveBand(asset.rentalRate, asset.meterType);
    const { points, rejected, meteredIssues } = buildIntervals(anchors, asset.meterType, basis);
    const totalLitres = anchors.reduce((s, a) => s + a.litres, 0);

    const actualRate = median(points.map((p) => p.rate));
    // A verdict needs both a comparable band and enough intervals to be a
    // measurement rather than a reading pair.
    const enough = points.length >= MIN_INTERVALS_FOR_VERDICT;
    const state =
      band.comparable && enough
        ? classifyConsumption(actualRate, band.econ, band.typ, band.heavy)
        : null;

    out.set(asset.id, {
      assetId: asset.id,
      code: asset.code,
      meterType: asset.meterType,
      basis,
      band,
      points,
      shape: points.length >= 2 ? "line" : points.length === 1 ? "single" : "empty",
      actualRate,
      state,
      severity: actualRate != null && band.typ ? actualRate / band.typ : 0,
      emptyReason: emptyReasonFor(meteredIssues, totalLitres, points.length),
      totalLitres: Math.round(totalLitres * 100) / 100,
      meteredIssues,
      rejected,
    });
  }

  return out;
}
