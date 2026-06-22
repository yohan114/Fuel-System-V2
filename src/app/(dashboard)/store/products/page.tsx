import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { productOverview } from "@/lib/stock/queries";
import { Package, AlertTriangle, PackagePlus } from "lucide-react";
import ProductForm from "./ProductForm";
import ReorderInput from "./ReorderInput";

function fmtRs(cents: number | null) {
  if (cents == null) return "—";
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function StoreProductsPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "STOREKEEPER") redirect("/");

  const data = await productOverview();

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Package className="w-5 h-5 text-indigo-400" /> Stock Products
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Oils, lubricants, greases and consumables. Balances come from the stock ledger; set a reorder level to get low-stock alerts.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Products</span>
          <span className="text-2xl font-bold text-white block mt-1">{data.productCount}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider">Stock Value</span>
          <span className="text-2xl font-bold text-emerald-400 block mt-1">{fmtRs(data.totalValueCents)}</span>
        </div>
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-5">
          <span className="text-[10px] text-gray-500 font-semibold uppercase block tracking-wider flex items-center gap-1">
            {data.lowStockCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-400" />} Low Stock
          </span>
          <span className={`text-2xl font-bold block mt-1 ${data.lowStockCount > 0 ? "text-amber-400" : "text-white"}`}>{data.lowStockCount}</span>
        </div>
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl">
        <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-4">
          <PackagePlus className="w-4 h-4 text-emerald-400" /> Add a product
        </h2>
        <ProductForm />
      </div>

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Catalog</h2>
        {data.rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No products yet — add one above or run the importer.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Product</th>
                <th className="py-2.5">Category</th>
                <th className="py-2.5 text-center">On hand</th>
                <th className="py-2.5 text-right">Reorder at</th>
                <th className="py-2.5 text-right">Unit price</th>
                <th className="py-2.5 text-right">Value</th>
                <th className="py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.01]">
                  <td className="py-3 font-semibold text-white">{r.name}{!r.active && <span className="ml-2 text-[9px] text-gray-500">(inactive)</span>}</td>
                  <td className="py-3 text-gray-400">{r.category ?? "—"}</td>
                  <td className="py-3 text-center text-gray-200 font-semibold">{r.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-gray-500">{r.unit}</span></td>
                  <td className="py-3 text-right"><ReorderInput id={r.id} value={r.reorderLevel} /></td>
                  <td className="py-3 text-right text-gray-400">{fmtRs(r.unitPriceCents)}</td>
                  <td className="py-3 text-right text-emerald-400 font-semibold">{fmtRs(r.valueCents)}</td>
                  <td className="py-3 text-center">
                    {r.low ? (
                      <span className="text-[9px] font-semibold rounded px-1.5 py-0.5 border bg-amber-500/10 text-amber-400 border-amber-500/20">LOW</span>
                    ) : (
                      <span className="text-[9px] font-semibold rounded px-1.5 py-0.5 border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Edit the reorder level inline (auto-saves as an audited update). Value = on-hand × unit price.</p>
      </div>
    </div>
  );
}
