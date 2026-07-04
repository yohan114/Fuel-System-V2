import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import AssetCharts from "./components/AssetCharts";
import AssetEditor from "./components/AssetEditor";
import FuelConsumptionEditor from "./components/FuelConsumptionEditor";
import { recommendedUnits, varianceFlag, formatVariancePct } from "@/lib/reports/recommended";
import { classifyConsumption } from "@/lib/analytics/consumption";
import { computeServiceStatus } from "@/lib/service/compute";
import { getBreakdownEpisodes } from "@/lib/breakdowns";
import { logServiceAction, setServiceIntervalAction } from "@/app/actions/service";
import { 
  ArrowLeft, 
  Gauge, 
  Fuel, 
  FileText, 
  MapPin, 
  Bookmark, 
  Settings,
  History,
  Activity,
  Wrench
} from "lucide-react";

interface PageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function AssetDetailPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const params = await props.params;
  const searchParams = await props.searchParams;
  
  const code = params.code;
  const activeTab = searchParams.tab || "issues";
  const isAdmin = session.role === "ADMIN";

  // 1. Query the asset
  const asset = await prisma.asset.findUnique({
    where: { code },
    include: { category: true, rentalRate: true },
  });

  if (!asset || asset.status === "DISPOSED") {
    notFound();
  }

  // Check project user scope
  if (session.role === "USER" && session.projectId && asset.projectId !== session.projectId) {
    notFound();
  }

  // 2. Fetch logs
  const issues = await prisma.fuelIssue.findMany({
    where: { assetId: asset.id },
    orderBy: { issueDate: "desc" },
    omit: { photoData: true },
    include: { issuedBy: true },
  });

  const requests = await prisma.fuelRequest.findMany({
    where: { assetId: asset.id },
    orderBy: { createdAt: "desc" },
    omit: { photoData: true },
    include: { requestedBy: true, reviewedBy: true },
  });

  const readings = await prisma.meterReading.findMany({
    where: { assetId: asset.id },
    orderBy: { readingDate: "desc" },
    include: { recordedBy: true },
  });

  // Service planner data for the Service tab.
  const serviceStatus = await computeServiceStatus(asset.id);
  const serviceRecords = await prisma.serviceRecord.findMany({
    where: { assetId: asset.id },
    orderBy: { serviceDate: "desc" },
    include: { recordedBy: { select: { name: true } }, _count: { select: { items: true } } },
  });
  const serviceUnit = serviceStatus?.basis === "KM" ? "km" : "hr";

  // Breakdown episodes over the last 6 months, for the Service tab strip.
  const breakdownLog = await getBreakdownEpisodes({
    from: new Date(Date.now() - 183 * 86400000),
    to: new Date(),
    assetId: asset.id,
  });

  // Filters that fit this machine (merged from the Service Record System).
  const machineFilters = await prisma.assetFilter.findMany({
    where: { assetId: asset.id },
    include: { filter: true },
    orderBy: { filter: { category: "asc" } },
  });

  // 3. Compute efficiency metrics
  let totalLitres = 0;
  let totalCostCents = 0;
  issues.forEach((i) => {
    totalLitres += i.litres;
    totalCostCents += i.totalCost;
  });

  // Calculate run Growth (Last reading - First reading)
  const firstReading = await prisma.meterReading.findFirst({
    where: { assetId: asset.id, readingType: asset.meterType },
    orderBy: { value: "asc" },
  });
  const lastReading = await prisma.meterReading.findFirst({
    where: { assetId: asset.id, readingType: asset.meterType },
    orderBy: { value: "desc" },
  });

  const runGrowth = firstReading && lastReading && lastReading.value > firstReading.value
    ? lastReading.value - firstReading.value
    : 0;

  let efficiency: string = "—";
  if (runGrowth > 0 && totalLitres > 0) {
    if (asset.meterType === "KM") {
      const value = runGrowth / totalLitres;
      efficiency = `${value.toFixed(2)} km/L`;
    } else {
      const value = totalLitres / runGrowth;
      efficiency = `${value.toFixed(2)} L/hr`;
    }
  }

  // Lifetime fuel-derived recommendation vs the recorded meter (reuses the
  // totals already computed above — no extra query).
  const recommendedLifetime = recommendedUnits(totalLitres, asset.rentalRate?.fuelConsTyp ?? null);
  const lifetimeVariance = varianceFlag(runGrowth, recommendedLifetime);

  // 4. Format Chart Data (Sorted chronologically)
  const readingsChartData = readings
    .map((r) => ({
      date: new Date(r.readingDate).toLocaleDateString("en-US", { day: "numeric", month: "short" }),
      value: r.value,
    }))
    .reverse();

  const issuesChartData = issues
    .map((i) => ({
      date: new Date(i.issueDate).toLocaleDateString("en-US", { day: "numeric", month: "short" }),
      litres: i.litres,
    }))
    .reverse();

  return (
    <div className="space-y-8">
      {/* Breadcrumb & Top Controls */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <Link
          href="/fleet"
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Directory
        </Link>
        {isAdmin && <AssetEditor asset={asset} />}
      </div>

      {/* Hero Specifications Card */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 md:p-8 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg flex-shrink-0">
              <Gauge className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white tracking-wide">{asset.code}</h1>
                <span className="bg-indigo-500/10 border border-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase">
                  {asset.category.name}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  asset.status === "ACTIVE" 
                    ? "bg-emerald-500/10 border border-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 border border-red-500/10 text-red-400"
                }`}>
                  {asset.status}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-2 font-medium">
                {asset.brand || "Generic"} {asset.model || ""}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-3 font-semibold">
                <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Site: {asset.site || "Not assigned"}</span>
                <span>•</span>
                <span className="font-mono">Reg No: {asset.regNo || "—"}</span>
              </div>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-6 bg-[#1b1e30] border border-white/5 p-5 rounded-2xl min-w-full lg:min-w-[420px] text-center shadow-inner">
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Total Fuel</span>
              <span className="text-md font-bold text-white block mt-1">{totalLitres.toFixed(0)}L</span>
              <span className="text-[10px] text-gray-500 block mt-0.5">Rs.{(totalCostCents/100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}</span>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Running ({asset.meterType})</span>
              <span className="text-md font-bold text-white block mt-1">{runGrowth.toLocaleString()}</span>
              <span className="text-[10px] text-gray-500 block mt-0.5">Growth logs</span>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Economy</span>
              <span className="text-md font-bold text-emerald-400 block mt-1">{efficiency}</span>
              <span className="text-[10px] text-gray-500 block mt-0.5">efficiency rate</span>
            </div>
          </div>
        </div>

        {/* Detailed specs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8 pt-8 border-t border-white/5 text-xs">
          <div>
            <span className="text-gray-500 block font-semibold">Capacity</span>
            <span className="text-gray-300 font-medium mt-1 block">{asset.capacity || "—"}</span>
          </div>
          <div>
            <span className="text-gray-500 block font-semibold">Year of Manufacture</span>
            <span className="text-gray-300 font-medium mt-1 block">{asset.yom || "—"}</span>
          </div>
          <div>
            <span className="text-gray-500 block font-semibold">Serial Number</span>
            <span className="text-gray-300 font-medium mt-1 block">{asset.serialNo || "—"}</span>
          </div>
          <div>
            <span className="text-gray-500 block font-semibold">Engine / Chassis No</span>
            <span className="text-gray-300 font-medium mt-1 block truncate">
              {asset.engineNo || "—"} / {asset.chassisNo || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Fuel-derived recommended hrs/km vs recorded meter */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" /> Fuel vs Meter — System-Recommended ({asset.meterType})
        </h3>
        {asset.rentalRate?.fuelConsTyp ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="bg-[#1b1e30] border border-white/5 rounded-xl p-4">
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Actual Meter</span>
              <span className="text-md font-bold text-white block mt-1">{runGrowth.toLocaleString()} {asset.meterType}</span>
            </div>
            <div className="bg-[#1b1e30] border border-white/5 rounded-xl p-4">
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Recommended (fuel)</span>
              <span className="text-md font-bold text-indigo-400 block mt-1">
                {recommendedLifetime != null ? `${recommendedLifetime.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${asset.meterType}` : "—"}
              </span>
            </div>
            <div className="bg-[#1b1e30] border border-white/5 rounded-xl p-4">
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Variance</span>
              <span className={`text-md font-bold block mt-1 ${
                lifetimeVariance.flag === "METER_LOW" ? "text-red-400" : lifetimeVariance.flag === "METER_HIGH" ? "text-amber-400" : "text-white"
              }`}>
                {formatVariancePct(lifetimeVariance.variancePct) ?? "—"}
              </span>
              <span className="text-[10px] text-gray-500 block mt-0.5">
                {lifetimeVariance.flag === "METER_LOW" ? "meter under-recorded?" : lifetimeVariance.flag === "METER_HIGH" ? "meter high" : "within tolerance"}
              </span>
            </div>
            <div className="bg-[#1b1e30] border border-white/5 rounded-xl p-4">
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">Consumption Band</span>
              <span className="text-md font-bold text-white block mt-1">
                {asset.rentalRate.fuelConsEcon ?? "—"} / {asset.rentalRate.fuelConsTyp} / {asset.rentalRate.fuelConsHeavy ?? "—"} L/{asset.meterType === "KM" ? "km" : "hr"}
              </span>
              {(() => {
                const rate = runGrowth > 0 && totalLitres > 0 ? totalLitres / runGrowth : null;
                const st = classifyConsumption(rate, asset.rentalRate.fuelConsEcon, asset.rentalRate.fuelConsTyp, asset.rentalRate.fuelConsHeavy);
                const style =
                  st === "OVER" ? "text-rose-400" : st === "HEAVY" ? "text-amber-400" : st === "NORMAL" ? "text-emerald-400" : st === "BELOW_ECON" ? "text-sky-400" : "text-gray-500";
                const label =
                  st === "OVER" ? "over heavy — repair candidate" : st === "HEAVY" ? "heavy burn" : st === "NORMAL" ? "within band" : st === "BELOW_ECON" ? "below econ — check reporting" : "no meter data";
                return (
                  <span className={`text-[10px] block mt-0.5 ${style}`}>
                    actual {rate != null ? rate.toFixed(2) : "—"} L/{asset.meterType === "KM" ? "km" : "hr"} — {label}
                  </span>
                );
              })()}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No typical consumption rate set{isAdmin ? " — add one above" : ""} to compute the fuel-derived recommendation.</p>
        )}
      </div>

      {/* Visual Analytics */}
      <AssetCharts
        readingsData={readingsChartData}
        issuesData={issuesChartData}
        meterType={asset.meterType}
      />

      {/* Admin: fuel consumption rate for fuel-derived billing */}
      {isAdmin && (
        <FuelConsumptionEditor
          assetId={asset.id}
          meterType={asset.meterType}
          fuelConsEcon={asset.rentalRate?.fuelConsEcon ?? null}
          fuelConsTyp={asset.rentalRate?.fuelConsTyp ?? null}
          fuelConsBasis={asset.rentalRate?.fuelConsBasis ?? null}
        />
      )}

      {/* Historical Logs & Tabs */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl shadow-xl overflow-hidden">
        {/* Tab Headers */}
        <div className="flex border-b border-white/5 bg-white/5">
          <Link
            href={`/fleet/${asset.code}?tab=issues`}
            className={`flex items-center gap-2 px-6 py-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "issues"
                ? "border-indigo-500 text-white bg-[#121420]"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <Fuel className="w-4 h-4" />
            Issues ({issues.length})
          </Link>
          <Link
            href={`/fleet/${asset.code}?tab=requests`}
            className={`flex items-center gap-2 px-6 py-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "requests"
                ? "border-indigo-500 text-white bg-[#121420]"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <FileText className="w-4 h-4" />
            Requests ({requests.length})
          </Link>
          <Link
            href={`/fleet/${asset.code}?tab=readings`}
            className={`flex items-center gap-2 px-6 py-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "readings"
                ? "border-indigo-500 text-white bg-[#121420]"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <Activity className="w-4 h-4" />
            Meter Readings ({readings.length})
          </Link>
          <Link
            href={`/fleet/${asset.code}?tab=service`}
            className={`flex items-center gap-2 px-6 py-4 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "service"
                ? "border-indigo-500 text-white bg-[#121420]"
                : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            <Wrench className="w-4 h-4" />
            Service ({serviceRecords.length})
          </Link>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          
          {/* A. Issues Log */}
          {activeTab === "issues" && (
            <div className="overflow-x-auto">
              {issues.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">No dispatches found.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-gray-400 font-semibold border-b border-white/5 pb-2">
                      <th className="py-3">Date</th>
                      <th className="py-3">Fuel Kind</th>
                      <th className="py-3">Litres</th>
                      <th className="py-3">Reading ({asset.meterType})</th>
                      <th className="py-3">Total Cost</th>
                      <th className="py-3">Issued By</th>
                      <th className="py-3">Source</th>
                      <th className="py-3">Proof</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {issues.map((issue) => (
                      <tr key={issue.id} className="hover:bg-white/[0.01]">
                        <td className="py-3.5 text-gray-300 font-medium">
                          {new Date(issue.issueDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-3.5 text-gray-400 capitalize">
                          {issue.fuelKind.replace("_", " ").toLowerCase()}
                        </td>
                        <td className="py-3.5 text-white font-bold">{issue.litres}L</td>
                        <td className="py-3.5 text-gray-300 font-mono">
                          {issue.meterReading !== null ? issue.meterReading.toLocaleString() : "—"}
                        </td>
                        <td className="py-3.5 text-white font-bold">
                          Rs. {(issue.totalCost / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3.5 text-gray-400">{issue.issuedBy.name}</td>
                        <td className="py-3.5"><span className="bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400">{issue.source}</span></td>
                        <td className="py-3.5">
                          {issue.photoName ? (
                            <a href={`/api/fuel-issues/${issue.id}/photo`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 text-[10px] font-semibold underline">
                              View
                            </a>
                          ) : (
                            <span className="text-gray-600 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* B. Requests Log */}
          {activeTab === "requests" && (
            <div className="overflow-x-auto">
              {requests.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">No requests found.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-gray-400 font-semibold border-b border-white/5 pb-2">
                      <th className="py-3">Date</th>
                      <th className="py-3">Litres</th>
                      <th className="py-3">Reading ({asset.meterType})</th>
                      <th className="py-3">Status</th>
                      <th className="py-3">Requested By</th>
                      <th className="py-3">Reviewed By</th>
                      <th className="py-3">Review Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {requests.map((req) => (
                      <tr key={req.id} className="hover:bg-white/[0.01]">
                        <td className="py-3.5 text-gray-300 font-medium">
                          {new Date(req.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-3.5 text-white font-bold">{req.requestedLitres}L</td>
                        <td className="py-3.5 text-gray-300 font-mono">
                          {req.meterReading !== null ? req.meterReading.toLocaleString() : "—"}
                        </td>
                        <td className="py-3.5">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                            req.status === "APPROVED"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : req.status === "REJECTED"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-amber-500/10 text-amber-400"
                          }`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="py-3.5 text-gray-400">{req.requestedBy.name}</td>
                        <td className="py-3.5 text-gray-400">{req.reviewedBy?.name || "—"}</td>
                        <td className="py-3.5 text-gray-500 max-w-[200px] truncate" title={req.reviewNote || ""}>
                          {req.reviewNote || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* C. Readings Log */}
          {activeTab === "readings" && (
            <div className="overflow-x-auto">
              {readings.length === 0 ? (
                <div className="text-center py-8 text-xs text-gray-500">No readings found.</div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-gray-400 font-semibold border-b border-white/5 pb-2">
                      <th className="py-3">Date</th>
                      <th className="py-3">Reading Value ({asset.meterType})</th>
                      <th className="py-3">Source</th>
                      <th className="py-3">Logged By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {readings.map((reading) => (
                      <tr key={reading.id} className="hover:bg-white/[0.01]">
                        <td className="py-3.5 text-gray-300 font-medium">
                          {new Date(reading.readingDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="py-3.5 text-white font-bold font-mono text-sm">
                          {reading.value.toLocaleString()} {asset.meterType}
                        </td>
                        <td className="py-3.5 capitalize">
                          <span className="bg-white/5 px-2 py-0.5 rounded text-[9px] uppercase font-bold text-gray-400">
                            {reading.source.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-3.5 text-gray-400">{reading.recordedBy.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* D. Service Planner */}
          {activeTab === "service" && (
            <div className="space-y-6">
              {serviceStatus ? (
                <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Service Status</h4>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold border ${
                      serviceStatus.state === "OVERDUE" ? "bg-red-500/10 text-red-400 border-red-500/15"
                      : serviceStatus.state === "DUE_SOON" ? "bg-amber-500/10 text-amber-400 border-amber-500/15"
                      : serviceStatus.state === "OK" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/15"
                      : "bg-gray-500/10 text-gray-400 border-gray-500/15"}`}>{serviceStatus.state.replace("_", " ")}</span>
                  </div>
                  {serviceStatus.usedSince != null && (
                    <div className="mb-4">
                      <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                        <span>{serviceStatus.usedSince.toFixed(0)} / {serviceStatus.intervalValue.toFixed(0)} {serviceUnit} used</span>
                        <span>{serviceStatus.remaining != null ? `${Math.max(0, serviceStatus.remaining).toFixed(0)} ${serviceUnit} left` : ""}</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div className={`h-full ${serviceStatus.state === "OVERDUE" ? "bg-red-500" : serviceStatus.state === "DUE_SOON" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (serviceStatus.usedSince / serviceStatus.intervalValue) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-[#121420] border border-white/5 rounded-xl p-3"><span className="text-[10px] text-gray-500 uppercase block">Recorded since</span><span className="text-white font-bold">{serviceStatus.recordedSince != null ? `${serviceStatus.recordedSince.toFixed(0)} ${serviceUnit}` : "—"}</span></div>
                    <div className="bg-[#121420] border border-white/5 rounded-xl p-3"><span className="text-[10px] text-gray-500 uppercase block">Fuel-derived since</span><span className="text-white font-bold">{serviceStatus.fuelDerivedSince != null ? `${serviceStatus.fuelDerivedSince.toFixed(0)} ${serviceUnit}` : "—"}</span></div>
                    <div className="bg-[#121420] border border-white/5 rounded-xl p-3"><span className="text-[10px] text-gray-500 uppercase block">Interval ({serviceStatus.intervalSource})</span><span className="text-white font-bold">{serviceStatus.intervalValue.toFixed(0)} {serviceUnit}</span></div>
                    <div className="bg-[#121420] border border-white/5 rounded-xl p-3"><span className="text-[10px] text-gray-500 uppercase block">Projected due</span><span className="text-white font-bold">{serviceStatus.projectedDueDate ? new Date(serviceStatus.projectedDueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span></div>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-3">
                    Last service: {serviceStatus.lastServiceDate ? new Date(serviceStatus.lastServiceDate).toLocaleDateString("en-GB") : "none on record — measuring since commissioning"}. Countdown uses the higher of recorded and fuel-derived running.{" "}
                    <Link href={`/service/plan/${encodeURIComponent(asset.code)}`} className="text-indigo-400 hover:underline font-bold">Full service plan →</Link>
                  </p>
                </div>
              ) : (
                <div className="text-xs text-gray-500">No service data available for this vehicle.</div>
              )}

              {breakdownLog.episodes.length > 0 && (
                <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Breakdown History (6 months)</h4>
                    <Link href="/breakdowns" className="text-[10px] font-bold text-indigo-400 hover:underline">Breakdown log →</Link>
                  </div>
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-400 font-semibold border-b border-white/5">
                        <th className="py-2">From</th>
                        <th className="py-2">To</th>
                        <th className="py-2 text-right">Days</th>
                        <th className="py-2">Status</th>
                        <th className="py-2">Last note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {breakdownLog.episodes.slice(0, 8).map((e) => (
                        <tr key={e.startDay}>
                          <td className="py-2.5 text-gray-300">{new Date(`${e.startDay}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="py-2.5 text-gray-300">{new Date(`${e.endDay}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="py-2.5 text-right font-bold text-amber-400">{e.days}</td>
                          <td className="py-2.5">
                            {e.open ? (
                              <span className="text-[9px] font-bold rounded px-2 py-0.5 bg-rose-500/10 text-rose-400">STILL DOWN</span>
                            ) : (
                              <span className="text-[9px] font-bold rounded px-2 py-0.5 bg-emerald-500/10 text-emerald-400">REPAIRED</span>
                            )}
                          </td>
                          <td className="py-2.5 text-gray-500 max-w-[220px] truncate" title={e.lastNote || ""}>{e.lastNote || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {machineFilters.length > 0 && (
                <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Filters &amp; Oils for this Machine</h4>
                    <Link href="/filters" className="text-[10px] font-bold text-indigo-400 hover:underline">Filter database →</Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {machineFilters.map((mf) => (
                      <Link
                        key={mf.id}
                        href={`/filters?q=${encodeURIComponent(mf.filter.hifiPartNo || mf.filter.oemPartNo || "")}`}
                        className="bg-[#121420] border border-white/5 hover:border-indigo-500/30 rounded-xl px-3 py-2.5"
                      >
                        <span className="text-[10px] text-gray-500 uppercase block truncate">{mf.filter.category ?? "Filter"}</span>
                        <span className="text-xs font-bold text-white font-mono block truncate">{mf.filter.hifiPartNo || mf.filter.oemPartNo || "—"}</span>
                        <span className="text-[10px] text-gray-500 block">
                          {mf.filter.priceCents != null ? `Rs ${(mf.filter.priceCents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}` : "no price"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <form action={async (fd) => { "use server"; await logServiceAction(fd); }} className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5 space-y-3">
                    <input type="hidden" name="assetId" value={asset.id} />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Log a Service</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" name="serviceDate" required defaultValue={new Date().toISOString().split("T")[0]} className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                      <input type="number" step="0.1" name="meterAtService" placeholder={`Meter (${asset.meterType})`} className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                      <input type="text" name="serviceType" placeholder="Type e.g. 500HR / Oil" className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                      <input type="number" step="0.01" name="costLkr" placeholder="Cost (LKR)" className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                      <input type="text" name="jobNo" placeholder="Job No (optional)" className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs col-span-2" />
                    </div>
                    <input type="text" name="note" placeholder="Note (optional)" className="w-full bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2">Log service</button>
                  </form>

                  <form action={async (fd) => { "use server"; await setServiceIntervalAction(fd); }} className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5 space-y-3">
                    <input type="hidden" name="scope" value="asset" />
                    <input type="hidden" name="assetId" value={asset.id} />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Override Interval (this vehicle)</h4>
                    <div className="grid grid-cols-3 gap-2">
                      <select name="basis" defaultValue={serviceStatus?.basis || (asset.meterType === "KM" ? "KM" : "HOURS")} className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs">
                        <option value="HOURS">Hours</option>
                        <option value="KM">KM</option>
                      </select>
                      <input type="number" step="1" name="intervalValue" required placeholder="Interval" defaultValue={serviceStatus?.intervalValue} className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                      <input type="number" step="1" name="intervalMonths" placeholder="Months?" className="bg-[#121420] border border-white/5 rounded-lg px-3 py-2 text-white text-xs" />
                    </div>
                    <button type="submit" className="bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-lg px-4 py-2">Save override</button>
                  </form>
                </div>
              )}

              <div className="overflow-x-auto">
                {serviceRecords.length === 0 ? (
                  <div className="text-center py-8 text-xs text-gray-500">No services logged yet.</div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="text-gray-400 font-semibold border-b border-white/5">
                        <th className="py-3">Date</th>
                        <th className="py-3">Job No</th>
                        <th className="py-3">Meter</th>
                        <th className="py-3">Type</th>
                        <th className="py-3 text-right">Parts</th>
                        <th className="py-3">Cost</th>
                        <th className="py-3">Note</th>
                        <th className="py-3">Logged By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {serviceRecords.map((s) => (
                        <tr key={s.id} className="hover:bg-white/[0.01]">
                          <td className="py-3 text-gray-300">{new Date(s.serviceDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td className="py-3 text-gray-400 font-mono">{s.jobNo || "—"}</td>
                          <td className="py-3 text-gray-400 font-mono">{s.meterAtService != null ? `${s.meterAtService.toLocaleString()} ${s.meterType}` : "—"}</td>
                          <td className="py-3 text-gray-300">{s.serviceType || "—"}</td>
                          <td className="py-3 text-right text-gray-400">{s._count.items > 0 ? s._count.items : "—"}</td>
                          <td className="py-3 text-gray-400" title={s.labourCents != null || s.sundryCents != null ? `parts ${s.partsCents != null ? (s.partsCents / 100).toLocaleString("en-LK") : "—"} · labour ${s.labourCents != null ? (s.labourCents / 100).toLocaleString("en-LK") : "—"} · sundry ${s.sundryCents != null ? (s.sundryCents / 100).toLocaleString("en-LK") : "—"}` : ""}>{s.costCents != null ? `Rs. ${(s.costCents / 100).toLocaleString("en-LK")}` : "—"}</td>
                          <td className="py-3 text-gray-500 max-w-[220px] truncate" title={s.note || ""}>{s.note || "—"}</td>
                          <td className="py-3 text-gray-400">{s.recordedBy.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
