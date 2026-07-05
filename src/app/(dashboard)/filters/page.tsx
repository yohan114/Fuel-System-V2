import React from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { normalizePN } from "@/lib/filters/normalize";
import { Filter as FilterIcon, Search, Fuel, Coins, Link2 } from "lucide-react";

// Filter cross-reference engine, merged from the E&C Service Record System:
// type any part number (OEM, HIFI, Fleetguard, Donaldson, Baldwin, Sakura,
// VIC …) and get the filter, every equivalent, its price and the machines
// that use it.

interface PageProps {
  searchParams: Promise<{ q?: string; cat?: string }>;
}

function rs(cents: number | null) {
  return cents == null ? "—" : "Rs " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

export default async function FiltersPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const sp = await props.searchParams;
  const q = (sp.q || "").trim();
  const cat = (sp.cat || "").trim();

  const [total, priced, xrefs, linked, categories] = await Promise.all([
    prisma.filter.count(),
    prisma.filter.count({ where: { priceCents: { not: null } } }),
    prisma.filterCrossRef.count(),
    prisma.assetFilter.count({ where: { assetId: { not: null } } }),
    prisma.filter.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
  ]);

  let results: Awaited<ReturnType<typeof searchFilters>> = [];
  if (q) {
    results = await searchFilters(q);
  } else {
    results = await prisma.filter.findMany({
      where: cat ? { category: cat } : {},
      include: {
        crossRefs: true,
        assetLinks: { include: { asset: { select: { code: true } } } },
      },
      orderBy: [{ category: "asc" }, { hifiPartNo: "asc" }],
      take: 60,
    });
  }

  async function searchFilters(query: string) {
    const norm = normalizePN(query);
    const byPN = norm.length >= 2
      ? await prisma.filterCrossRef.findMany({
          where: { normalizedPN: { contains: norm } },
          select: { filterId: true },
          take: 400,
        })
      : [];
    const ids = [...new Set(byPN.map((r) => r.filterId))];
    return prisma.filter.findMany({
      where: {
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          { description: { contains: query } },
        ],
      },
      include: {
        crossRefs: true,
        assetLinks: { include: { asset: { select: { code: true } } } },
      },
      take: 20,
    });
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <FilterIcon className="w-5 h-5 text-indigo-400" /> Filter Database &amp; Cross-Reference
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Type any part number — OEM, HIFI, Fleetguard, Donaldson, Baldwin, Sakura, VIC — to find the filter, every equivalent, its price and the machines that use it.
          </p>
        </div>
        <form method="GET" action="/filters" className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Part number or description</label>
            <input type="text" name="q" defaultValue={q} placeholder="e.g. LF9028 / SO 10058 / oil filter" className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs w-64" />
          </div>
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl px-4 py-2.5 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> Search
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label="Filters" value={total} icon={<FilterIcon className="w-4 h-4" />} className="text-white" />
        <Kpi label="With a price" value={priced} icon={<Coins className="w-4 h-4" />} className="text-emerald-400" />
        <Kpi label="Cross-references" value={xrefs} icon={<Link2 className="w-4 h-4" />} className="text-indigo-400" />
        <Kpi label="Machine links" value={linked} icon={<Fuel className="w-4 h-4" />} className="text-gray-300" />
      </div>

      {!q && (
        <form method="GET" action="/filters" className="flex items-center gap-2">
          <select name="cat" defaultValue={cat} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category!} value={c.category!}>{c.category}</option>
            ))}
          </select>
          <button type="submit" className="bg-white/5 hover:bg-white/10 border border-white/5 text-white font-semibold text-xs rounded-xl px-4 py-2">Browse</button>
          <span className="text-[10px] text-gray-500">showing {results.length} of {cat ? "category" : "all"} filters</span>
        </form>
      )}

      {q && results.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-10 text-center text-xs text-gray-500">
          No filter matches “{q}”. Try fewer characters of the part number.
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((f) => {
            const machines = f.assetLinks.filter((l) => l.asset).map((l) => l.asset!.code);
            const others = f.assetLinks.length - machines.length;
            const brands = new Map<string, string[]>();
            for (const x of f.crossRefs) {
              const b = x.brand || (x.refType === "oem" ? "OEM" : x.refType === "hifi" ? "HIFI" : "Other");
              (brands.get(b) ?? brands.set(b, []).get(b)!).push(x.partNumber);
            }
            return (
              <div key={f.id} className="bg-[#121420] border border-white/5 rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {f.category && <span className="bg-indigo-500/10 border border-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded uppercase">{f.category}</span>}
                      <span className="text-sm font-bold text-white font-mono">{f.hifiPartNo || f.oemPartNo || "—"}</span>
                      {f.hifiPartNo && f.oemPartNo && <span className="text-[10px] text-gray-500 font-mono">OEM {f.oemPartNo}</span>}
                    </div>
                    {f.description && <p className="text-xs text-gray-400 mt-1">{f.description}</p>}
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${f.priceCents != null ? "text-emerald-400" : "text-gray-600"}`}>{rs(f.priceCents)}</span>
                    {f.priceNote && <span className="block text-[10px] text-gray-500">{f.priceNote}</span>}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[...brands.entries()].map(([brand, pns]) => (
                    <span key={brand} className="text-[10px] bg-white/5 text-gray-300 rounded-lg px-2 py-1">
                      <span className="text-gray-500">{brand}:</span> <span className="font-mono">{[...new Set(pns)].slice(0, 4).join(", ")}</span>
                    </span>
                  ))}
                </div>

                {(machines.length > 0 || others > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 uppercase font-semibold tracking-wider mr-1">Used by</span>
                    {[...new Set(machines)].slice(0, 14).map((code) => (
                      <Link key={code} href={`/fleet/${code}`} className="text-[10px] font-mono font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 rounded-lg px-2 py-1">{code}</Link>
                    ))}
                    {machines.length > 14 && <span className="text-[10px] text-gray-500">+{machines.length - 14} more</span>}
                    {others > 0 && <span className="text-[10px] text-gray-600">(+{others} outside this fleet)</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, className, icon }: { label: string; value: number; className: string; icon: React.ReactNode }) {
  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 shadow-md">
      <div className="flex items-center gap-2 text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{icon}{label}</div>
      <div className={`text-lg font-bold mt-1 ${className}`}>{value.toLocaleString()}</div>
    </div>
  );
}
