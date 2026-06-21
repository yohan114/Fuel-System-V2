import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalize } from "@/lib/service/xref";
import { Package, ArrowLeft } from "lucide-react";

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

// Suggests what filters to buy this month, from the catalog's demand figures
// priced against the editable price book (matched by OEM/HIFI code).
export default async function OrderPlannerPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const [prices, filters] = await Promise.all([
    prisma.filterPrice.findMany({ where: { unitPriceCents: { gt: 0 } }, select: { normalizedCode: true, unitPriceCents: true, supplierCode: true } }),
    prisma.filterCatalog.findMany({
      where: { monthlyDemand: { gt: 0 } },
      orderBy: { monthlyDemand: "desc" },
      take: 200,
      select: { id: true, description: true, filterCategory: true, oemPartNumber: true, hifiPartNumber: true, monthlyDemand: true, annualDemand: true, serviceCount: true },
    }),
  ]);

  const priceMap = new Map<string, { cents: number; code: string }>();
  for (const p of prices) if (p.normalizedCode) priceMap.set(p.normalizedCode, { cents: p.unitPriceCents, code: p.supplierCode });

  const rows = filters.map((f) => {
    const hit = priceMap.get(normalize(f.oemPartNumber)) ?? priceMap.get(normalize(f.hifiPartNumber));
    const demand = f.monthlyDemand ?? 0;
    const monthlyCostCents = hit ? Math.round(hit.cents * demand) : null;
    return { ...f, unitCents: hit?.cents ?? null, priceCode: hit?.code ?? null, monthlyCostCents };
  });

  const totalMonthlyCents = rows.reduce((s, r) => s + (r.monthlyCostCents ?? 0), 0);
  const pricedCount = rows.filter((r) => r.unitCents != null).length;

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Package className="w-5 h-5 text-indigo-400" /> Filter Order Planner
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            What to stock this month — from each filter's demand priced against the price book. Estimates only; verify before ordering.
          </p>
        </div>
        <Link href="/service/cross-reference" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" /> Cross-Reference
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Est. Monthly Spend</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(totalMonthlyCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Filters Tracked</span>
          <span className="text-2xl font-bold text-white block mt-1">{rows.length}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 hidden sm:block">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Priced</span>
          <span className="text-2xl font-bold text-white block mt-1">{pricedCount}/{rows.length}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        {rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No demand data yet. Re-run the catalog import to populate filter demand.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Filter</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-right">Monthly demand</th>
                <th className="py-2.5 text-right">Annual</th>
                <th className="py-2.5 text-right">Unit price</th>
                <th className="py-2.5 text-right">Est. monthly cost</th>
                <th className="py-2.5 text-right">Services</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 max-w-[280px]">
                    <Link href={`/service/cross-reference?q=${encodeURIComponent(r.oemPartNumber || r.hifiPartNumber || "")}`} className="font-bold text-white hover:text-indigo-400">{r.oemPartNumber || r.hifiPartNumber || "—"}</Link>
                    <span className="block text-[10px] text-gray-500 truncate" title={r.description || ""}>{r.description || ""}</span>
                  </td>
                  <td className="py-3 text-gray-400">{r.filterCategory || "—"}</td>
                  <td className="py-3 text-right text-white font-semibold">{(r.monthlyDemand ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td className="py-3 text-right text-gray-400">{(r.annualDemand ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="py-3 text-right text-gray-400">{fmtRs(r.unitCents)}</td>
                  <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(r.monthlyCostCents)}</td>
                  <td className="py-3 text-right text-gray-500">{r.serviceCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Unit prices matched from the price book by OEM/HIFI code. Edit prices in Admin → Service Prices.</p>
      </div>
    </div>
  );
}
