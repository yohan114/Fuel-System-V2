import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  FileSpreadsheet,
  Truck,
  DollarSign,
  CalendarRange,
  Wrench,
  ArrowRight,
  Download,
} from "lucide-react";

export default async function AdminImportHubPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const importModules = [
    {
      title: "Fleet Vehicles & Machinery",
      description: "Batch import new vehicles, registration numbers, daily caps, and site bindings.",
      href: "/fleet/import",
      icon: Truck,
      color: "text-indigo-400",
      badge: "CSV / Text",
      sampleHeaders: "code, brand, model, regNo, categoryCode, meterType, site, dailyCapLitres, billFuelOnly",
    },
    {
      title: "Rental Rate Cards",
      description: "Update monthly/hourly hire rates across Wet, Dry, and Fully Wet pricing basis.",
      href: "/rates",
      icon: DollarSign,
      color: "text-emerald-400",
      badge: "Rates Console",
      sampleHeaders: "assetCode, hourlyRate, dailyRate, kmRate, hireBasis, fuelConsEcon, fuelConsTyp",
    },
    {
      title: "Site Vehicle Allocations",
      description: "Monthly deployment register: Stationing full fleet across construction sites.",
      href: "/admin/assignments",
      icon: CalendarRange,
      color: "text-amber-400",
      badge: "Allocation Grid",
      sampleHeaders: "siteName, month (YYYY-MM), vehicleNo, machineType, ownerCode, basis",
    },
    {
      title: "PM Service Task Master",
      description: "Preventive maintenance task ladders and intervals per vehicle category.",
      href: "/service/pm-master",
      icon: Wrench,
      color: "text-cyan-400",
      badge: "PM Master",
      sampleHeaders: "categoryCode, intervalHours, system, component, description, parts",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-indigo-400" /> Data Import & Bulk Ingestion Center
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Unified portal for importing spreadsheets, rate sheets, allocation masters, and fleet assets into Fuel System V2.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {importModules.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.title}
              className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/5">
                      <Icon className={`w-5 h-5 ${m.color}`} />
                    </div>
                    <h3 className="font-bold text-white text-sm">{m.title}</h3>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                    {m.badge}
                  </span>
                </div>

                <p className="text-xs text-gray-400 leading-relaxed">{m.description}</p>

                <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-gray-400 truncate">
                  <span className="text-gray-500 block text-[10px] uppercase font-sans mb-1">
                    Expected Columns
                  </span>
                  {m.sampleHeaders}
                </div>
              </div>

              <div className="pt-2">
                <Link
                  href={m.href}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-lg shadow-indigo-600/20"
                >
                  Open Importer <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
