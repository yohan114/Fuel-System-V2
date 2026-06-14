import React from "react";
import { prisma } from "@/lib/db";
import { addManualPriceAction } from "@/app/actions/admin";
import { Coins, Plus, Calendar, Bookmark, RefreshCw } from "lucide-react";

export default async function AdminPricesPage() {
  // 1. Fetch price logs
  const prices = await prisma.fuelPrice.findMany({
    include: {
      enteredBy: true,
    },
    orderBy: {
      effectiveFrom: "desc",
    },
  });

  // 2. Fetch latest current prices
  const activeAuto = prices.find(p => p.fuelKind === "AUTO_DIESEL");
  const activeSuper = prices.find(p => p.fuelKind === "SUPER_DIESEL");

  return (
    <div className="space-y-8">
      {/* Active Prices Widget */}
      <div>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
          Current Active Prices
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Lanka Auto Diesel</span>
              <span className="text-lg font-bold text-white block mt-1">
                Rs. {activeAuto ? (activeAuto.pricePerLitre / 100).toFixed(2) : "0.00"}
              </span>
            </div>
            <span className="bg-indigo-500/10 text-indigo-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase">
              {activeAuto?.source || "—"}
            </span>
          </div>

          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Lanka Super Diesel E4</span>
              <span className="text-lg font-bold text-white block mt-1">
                Rs. {activeSuper ? (activeSuper.pricePerLitre / 100).toFixed(2) : "0.00"}
              </span>
            </div>
            <span className="bg-emerald-500/10 text-emerald-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase">
              {activeSuper?.source || "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Price Override Form */}
      <div className="border-t border-white/5 pt-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-indigo-400" />
          Add Manual Price Override
        </h3>

        <form action={async (formData) => {
          "use server";
          await addManualPriceAction(formData);
        }} className="bg-white/5 border border-white/5 p-5 rounded-2xl space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Fuel Kind select */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Fuel Kind
              </label>
              <select
                name="fuelKind"
                required
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none focus:border-indigo-500/50"
              >
                <option value="AUTO_DIESEL">Lanka Auto Diesel</option>
                <option value="SUPER_DIESEL">Lanka Super Diesel Euro 4</option>
              </select>
            </div>

            {/* Price LKR */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                New Price (LKR per Litre)
              </label>
              <input
                type="number"
                name="priceLkr"
                step="0.01"
                min="0.01"
                required
                placeholder="e.g. 407.00"
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
              />
            </div>

            {/* Effective from */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Effective From Date
              </label>
              <input
                type="date"
                name="effectiveFrom"
                required
                defaultValue={new Date().toISOString().split("T")[0]}
                className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2.5 text-white text-xs focus:outline-none"
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Add Note / Justification
            </label>
            <input
              type="text"
              name="note"
              placeholder="e.g. Monthly Ceypetco revision override"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2.5 rounded-xl active:scale-95 transition-all shadow-md"
          >
            Apply Price Override
          </button>
        </form>
      </div>

      {/* Historical Price Revision log */}
      <div className="border-t border-white/5 pt-6">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-emerald-400" />
          Price Log History
        </h3>

        {prices.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-500">No logs found.</div>
        ) : (
          <div className="border border-white/5 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-white/5 text-gray-400 font-semibold border-b border-white/5">
                  <th className="px-4 py-3">Effective Date</th>
                  <th className="px-4 py-3">Fuel Kind</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Entered By</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {prices.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.01]">
                    <td className="px-4 py-3.5 text-gray-300 font-medium">
                      {new Date(p.effectiveFrom).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 capitalize">
                      {p.fuelKind.replace("_", " ").toLowerCase()}
                    </td>
                    <td className="px-4 py-3.5 text-white font-bold">
                      Rs. {(p.pricePerLitre / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                        p.source === "MANUAL"
                          ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/10"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/10"
                      }`}>
                        {p.source}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-gray-400">
                      {p.enteredBy.name}
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 truncate max-w-[200px]" title={p.note || ""}>
                      {p.note || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
