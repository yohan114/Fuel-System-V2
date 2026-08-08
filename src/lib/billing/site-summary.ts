import { prisma } from "../db";
import { resolvePeriod } from "./period";
import { getMonthSegments } from "../assignments";
import { getBillingConfig, minimumForMode } from "./config";

// What one site owes for one month — counted from that site alone.
//
// A Bill is per MACHINE per month. A machine that moved between sites carries
// every site it touched, and the invoice is addressed to whichever site held it
// longest, so "the bill for this site" is not a bill the system stores. Worse
// for reading it: the per-machine path re-attributes a month's fuel to segments
// by the SOURCE register, and fuel drawn from a pump belonging to neither of the
// month's sites is spread across them by day-share — LB-21's 110 L from the
// CEP-03 E pump in May arrived as 35.48 L on one site and 74.52 L on another,
// litres that no book anywhere records.
//
// This counts what the site can point at instead:
//
//   rental — the days the machine was POSTED here, and the guaranteed minimum
//            prorated to them (minimum × days here ÷ days in month)
//   fuel   — the issues drawn from THIS SITE'S OWN PUMPS in the month, whole
//            litres at the price each was issued at
//
// Both are figures a site manager can check against their own register, which
// is the point of a summary a site is asked to agree to.

export interface SiteSummaryLine {
  assetId: string;
  code: string;
  regNo: string | null;
  typeLabel: string | null;
  billingMode: "hourly" | "perkm" | "perday";
  rateBasis: string;
  unit: string;
  daysHere: number;
  daysInMonth: number;
  minimumFull: number;
  minimumProrated: number;
  /** Work the fuel implies: litres at this site ÷ the economic consumption rate. */
  consRefUnits: number | null;
  consEconRate: number | null;
  /** Movement of the real meter over the days at this site. Null when unread. */
  actualUnits: number | null;
  billableUnits: number;
  rateCents: number | null;
  rentalCents: number;
  fuelLitres: number;
  fuelCostCents: number;
  fuelIssues: number;
  lineTotalCents: number;
}

export interface SiteSummary {
  siteCode: string;
  siteName: string;
  periodKey: string;
  monthLabel: string;
  daysInMonth: number;
  lines: SiteSummaryLine[];
  rentalCents: number;
  fuelLitres: number;
  fuelCostCents: number;
  subtotalCents: number;
  /** Effective price per litre for the fuel counted here. */
  fuelRateCents: number | null;
  /** True when the counted issues were not all at one price, so the rate is an average. */
  fuelRateBlended: boolean;
  ssclRate: number;
  ssclCents: number;
  vatRate: number;
  vatCents: number;
  grandTotalCents: number;
  unrated: string[];            // posted here but no rate card — bills no rental
  billedDirect: string[];       // posted here but settled direct — deliberately not billed
}

function modeFor(meterType: string | null, equipType: string): "hourly" | "perkm" | "perday" {
  if (equipType === "PORTABLE") return "perday";
  if (meterType === "KM") return "perkm";
  if (meterType === "HOURS") return "hourly";
  return "perday";
}

type Rate = {
  hrFwCents: number | null; hrWCents: number | null; hrDCents: number | null;
  kmFwCents: number | null; kmWCents: number | null; kmDCents: number | null;
  dyFwCents: number | null; dyWCents: number | null; dyDCents: number | null;
  portDwCents: number | null; portDdCents: number | null;
};

function pickRate(r: Rate | null, mode: string, basis: string): number | null {
  if (!r) return null;
  if (mode === "hourly") return basis === "fw" ? r.hrFwCents : basis === "d" ? r.hrDCents : r.hrWCents;
  if (mode === "perkm") return basis === "fw" ? r.kmFwCents : basis === "d" ? r.kmDCents : r.kmWCents;
  if (r.portDwCents != null || r.portDdCents != null) return basis === "d" ? r.portDdCents : r.portDwCents;
  return basis === "fw" ? r.dyFwCents : basis === "d" ? r.dyDCents : r.dyWCents;
}

export async function buildSiteSummary(siteCode: string, year: number, month: number): Promise<SiteSummary> {
  const period = resolvePeriod(year, month);
  const cfg = await getBillingConfig();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const project = await prisma.project.findUnique({ where: { code: siteCode }, select: { id: true, code: true, name: true } });
  if (!project) throw new Error(`site ${siteCode} not found`);

  const tanks = await prisma.bulkTank.findMany({ where: { projectId: project.id }, select: { id: true } });
  const tankIds = tanks.map((t) => t.id);

  const posted = await prisma.assetAssignment.findMany({
    where: { projectId: project.id, startDate: { lte: period.end },
      OR: [{ endDate: null }, { endDate: { gte: period.start } }] },
    select: { assetId: true }, distinct: ["assetId"] });

  const assets = await prisma.asset.findMany({
    where: { id: { in: posted.map((p) => p.assetId) } },
    include: { rentalRate: true }, orderBy: { code: "asc" } });

  const lines: SiteSummaryLine[] = [];
  const unrated: string[] = [];
  const billedDirect: string[] = [];
  const prices = new Set<number>();

  for (const a of assets) {
    const segs = await getMonthSegments(a.id, period.start, period.end);
    const here = segs.filter((s) => s.projectId === project.id);
    const daysHere = here.reduce((n, s) => n + s.days, 0);
    if (!daysHere) continue;

    // Settled between the client and the machine's owner. It was on site and it
    // drew fuel, so it stays in the fleet and fuel reports — it just earns E&C
    // nothing. Named on the summary rather than dropped quietly, so a site can
    // see it was considered.
    if (a.billedDirect) { billedDirect.push(a.code); continue; }

    const mode = modeFor(a.meterType, a.rentalRate?.equipType ?? "");
    const basis = here[0]?.billingType === "DRY" ? "d" : (a.rentalRate?.defaultBasis ?? "w");
    const minimumFull = mode === "hourly" && a.minBillHours ? a.minBillHours : minimumForMode(cfg, mode);
    const minimumProrated = minimumFull * (daysHere / daysInMonth);
    const rateCents = pickRate(a.rentalRate as Rate | null, mode, basis);
    if (rateCents == null) unrated.push(a.code);

    // Only this site's own pumps, and only the days the machine was posted here.
    const fuel = await prisma.fuelIssue.findMany({
      where: { assetId: a.id, voided: false, bulkTankId: { in: tankIds },
        issueDate: { gte: period.start, lte: period.end } },
      select: { litres: true, totalCost: true, issueDate: true, pricePerLitre: true } });
    const onHereDays = fuel.filter((f) =>
      here.some((s) => f.issueDate >= s.start && f.issueDate <= s.end));
    for (const f of onHereDays) prices.add(f.pricePerLitre);
    const fuelLitres = onHereDays.reduce((n, f) => n + f.litres, 0);
    const fuelCostCents = onHereDays.reduce((n, f) => n + f.totalCost, 0);

    // Meter movement over the days at this site. A machine with no reading in
    // the window has no measured work — which is a different thing from zero,
    // and the guarantee is what it owes either way.
    const readings = await prisma.meterReading.findMany({
      where: { assetId: a.id, readingDate: { gte: period.start, lte: period.end } },
      orderBy: { readingDate: "asc" }, select: { value: true, readingDate: true } });
    const inWindow = readings.filter((r) => here.some((s) => r.readingDate >= s.start && r.readingDate <= s.end));
    const actualUnits = inWindow.length >= 2 ? inWindow[inWindow.length - 1].value - inWindow[0].value : null;

    // A second, independent read on the same question. The meter says what the
    // machine recorded; the fuel says what it must have burnt to do the work.
    // Cons Econ is the light-load end of the band, so this is the most
    // conservative estimate of hours the fuel can support — the figure to put
    // beside a meter, since it cannot be accused of flattering the bill.
    const consEconRate = a.rentalRate?.fuelConsEcon ?? null;
    const isMeterMode = mode === "hourly" || mode === "perkm";
    const consRefUnits = isMeterMode && consEconRate && consEconRate > 0 && fuelLitres > 0
      ? fuelLitres / consEconRate : null;

    const billableUnits = Math.max(actualUnits ?? 0, minimumProrated);
    const rentalCents = rateCents == null ? 0 : Math.round(billableUnits * rateCents);
    const chargesFuel = basis !== "d";
    const fuelChargedCents = chargesFuel ? fuelCostCents : 0;

    lines.push({
      assetId: a.id, code: a.code, regNo: a.regNo, typeLabel: a.typeLabel,
      billingMode: mode, rateBasis: basis,
      unit: mode === "perkm" ? "km" : mode === "hourly" ? "hr" : "days",
      daysHere, daysInMonth, minimumFull, minimumProrated,
      consRefUnits, consEconRate,
      actualUnits, billableUnits, rateCents, rentalCents,
      fuelLitres, fuelCostCents: fuelChargedCents, fuelIssues: onHereDays.length,
      lineTotalCents: rentalCents + fuelChargedCents,
    });
  }

  const rentalCents = lines.reduce((n, l) => n + l.rentalCents, 0);
  const fuelCostCents = lines.reduce((n, l) => n + l.fuelCostCents, 0);
  const fuelLitres = lines.reduce((n, l) => n + l.fuelLitres, 0);
  const subtotalCents = rentalCents + fuelCostCents;
  const ssclCents = Math.round(subtotalCents * cfg.ssclRate);
  const vatCents = Math.round((subtotalCents + ssclCents) * cfg.vatRate);

  return {
    siteCode: project.code, siteName: project.name,
    periodKey: period.periodKey,
    monthLabel: period.start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Asia/Colombo" }),
    daysInMonth, lines,
    rentalCents, fuelLitres, fuelCostCents, subtotalCents,
    // Derived from the money actually charged, not from a price table, so it
    // always reconciles with the line above it.
    fuelRateCents: fuelLitres > 0 ? Math.round(fuelCostCents / fuelLitres) : null,
    fuelRateBlended: prices.size > 1,
    ssclRate: cfg.ssclRate, ssclCents, vatRate: cfg.vatRate, vatCents,
    grandTotalCents: subtotalCents + ssclCents + vatCents,
    unrated, billedDirect,
  };
}
