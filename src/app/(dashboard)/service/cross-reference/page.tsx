import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { search, filtersForVehicle, indexStats, type XrefResult } from "@/lib/service/xref";
import { rebuildXrefAction, deleteManualCrossRefAction } from "@/app/actions/xref";
import AddEquivalentForm from "./AddEquivalentForm";
import { Repeat, Search, Truck, RefreshCw, X } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ q?: string; ec?: string }>;
}

function fmtRs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function CrossReferencePage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  const isAdmin = session.role === "ADMIN";

  const sp = await props.searchParams;
  const q = (sp.q || "").trim();
  const ec = (sp.ec || "").trim();

  const stats = await indexStats();

  let results: XrefResult[] = [];
  let heading = "";
  let note = "";
  if (q) {
    const r = await search(q, 30);
    results = r.results;
    heading = `${r.count} filter${r.count === 1 ? "" : "s"} matching “${q}”`;
    note = r.note || "";
  } else if (ec) {
    results = await filtersForVehicle(ec);
    heading = `${results.length} filter${results.length === 1 ? "" : "s"} used by ${ec.toUpperCase()}`;
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Repeat className="w-5 h-5 text-indigo-400" /> Filter Cross-Reference
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Type any filter part number (OEM, HIFI, Fleetguard, Donaldson, Baldwin, Sakura…) to find the matching filter, its equivalents and price. {stats.filters.toLocaleString()} filters · {stats.totalCrossRefs.toLocaleString()} cross-references indexed.
          </p>
        </div>
        {isAdmin && (
          <form action={async () => { "use server"; await rebuildXrefAction(); }}>
            <button type="submit" className="text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 flex items-center gap-1.5 whitespace-nowrap">
              <RefreshCw className="w-4 h-4" /> Rebuild index
            </button>
          </form>
        )}
      </div>

      {/* Search forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex items-end gap-2">
          <label className="flex-1 block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">By part number</span>
            <input name="q" defaultValue={q} placeholder="e.g. FF5045, P550410, 31N8-01360" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-full focus:outline-none focus:border-indigo-500/40" />
          </label>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg px-4 py-2 flex items-center gap-1.5"><Search className="w-4 h-4" /> Search</button>
        </form>
        <form className="bg-[#121420] border border-white/5 rounded-2xl p-4 flex items-end gap-2">
          <label className="flex-1 block">
            <span className="text-[10px] text-gray-500 uppercase block mb-1">By vehicle (E&amp;C code)</span>
            <input name="ec" defaultValue={ec} placeholder="e.g. LB-01" className="bg-[#1b1e30] border border-white/5 rounded-lg px-3 py-2 text-white text-xs w-full focus:outline-none focus:border-indigo-500/40" />
          </label>
          <button type="submit" className="bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-lg px-4 py-2 flex items-center gap-1.5"><Truck className="w-4 h-4" /> Find</button>
        </form>
      </div>

      {/* Results */}
      {(q || ec) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 font-semibold">{heading}</span>
            {(q || ec) && <Link href="/service/cross-reference" className="text-xs text-gray-500 hover:text-white">Clear</Link>}
          </div>
          {note && <p className="text-xs text-amber-400">{note}</p>}
          {results.length === 0 && !note ? (
            <div className="bg-[#121420] border border-white/5 rounded-2xl text-center py-12 text-xs text-gray-500">No matching filters found.</div>
          ) : (
            results.map((r) => (
              <div key={r.catalogId} className="bg-[#121420] border border-white/5 rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-white">{r.description || r.category || "Filter"}</h3>
                    <p className="text-[11px] text-gray-500">
                      {r.category}{r.oem ? ` · OEM ${r.oem}` : ""}{r.hifi ? ` · HIFI ${r.hifi}` : ""}
                    </p>
                  </div>
                  {r.price && (
                    <div className="text-right">
                      <span className="text-[10px] text-gray-500 uppercase block">Price (est.)</span>
                      <span className="text-emerald-400 font-bold text-sm">{fmtRs(r.price.unitCents)}</span>
                      <span className="block text-[10px] text-gray-600">via {r.price.code}</span>
                    </div>
                  )}
                </div>

                {/* Equivalents grouped by brand */}
                <div className="mt-4 space-y-2">
                  {Object.entries(r.equivalents).map(([brand, items]) => (
                    <div key={brand} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase w-24 flex-shrink-0">{brand}</span>
                      {items.map((it) => {
                        const matched = it.partNumber === r.matchedPN;
                        return (
                          <span
                            key={it.id}
                            className={`inline-flex items-center gap-1 text-[11px] font-mono rounded px-2 py-0.5 border ${
                              matched ? "bg-indigo-500/20 text-indigo-200 border-indigo-500/30" : "bg-white/5 text-gray-300 border-white/5"
                            }`}
                          >
                            {it.partNumber}
                            {it.source === "manual" && <span className="text-[8px] uppercase text-amber-400">manual</span>}
                            {isAdmin && it.source === "manual" && (
                              <form action={async () => { "use server"; await deleteManualCrossRefAction(it.id); }} className="inline">
                                <button type="submit" title="Remove" className="text-gray-500 hover:text-red-400"><X className="w-3 h-3" /></button>
                              </form>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Machines that use this filter */}
                {r.vehicles.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 uppercase w-24 flex-shrink-0">Machines</span>
                    {r.vehicles.map((v) => (
                      <Link key={v.code} href={`/fleet/${v.code}`} className="text-[11px] rounded px-2 py-0.5 bg-white/5 border border-white/5 text-gray-300 hover:text-white">
                        {v.code}
                      </Link>
                    ))}
                  </div>
                )}

                {isAdmin && (
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <AddEquivalentForm catalogId={r.catalogId} />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
