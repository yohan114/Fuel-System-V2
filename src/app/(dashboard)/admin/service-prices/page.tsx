import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getFilterPriceList, getOilPriceList } from "@/lib/service/pricebook";
import PriceEditor, { type PriceRow } from "./PriceEditor";
import { Tags, Search, Droplets, Filter as FilterIcon } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ fq?: string }>;
}

export default async function ServicePricesPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/service");

  const sp = await props.searchParams;
  const fq = (sp.fq || "").trim();

  const [oilPrices, oilTypes, filterCats, filterPrices] = await Promise.all([
    getOilPriceList(),
    prisma.oilType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.filterCategoryRef.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    getFilterPriceList({ q: fq, take: fq ? 100 : 40 }),
  ]);

  const oilPriceRows: PriceRow[] = oilPrices.map((o) => ({ id: o.id, label: o.code, sub: o.description ?? undefined, cents: o.unitPriceCents }));
  const oilTypeRows: PriceRow[] = oilTypes.map((o) => ({ id: o.id, label: o.name, sub: `per ${o.unit}`, cents: o.unitPriceCents }));
  const filterCatRows: PriceRow[] = filterCats.map((f) => ({ id: f.id, label: f.name, cents: f.unitPriceCents }));
  const filterPriceRows: PriceRow[] = filterPrices.map((f) => ({ id: f.id, label: f.supplierCode, sub: f.description ?? undefined, cents: f.unitPriceCents }));

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Tags className="w-5 h-5 text-indigo-400" /> Service Price Books
        </h1>
        <p className="text-xs text-gray-400 mt-1">Edit the prices that auto-fill on the service sheet. Changes take effect on the next new service.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Oil grade prices" icon={<Droplets className="w-4 h-4 text-indigo-400" />} count={oilPriceRows.length}>
          <PriceEditor kind="oilPrice" rows={oilPriceRows} />
        </Section>
        <Section title="Oil line prices" icon={<Droplets className="w-4 h-4 text-indigo-400" />} count={oilTypeRows.length}>
          <PriceEditor kind="oilType" rows={oilTypeRows} />
        </Section>
        <Section title="Filter line prices" icon={<FilterIcon className="w-4 h-4 text-indigo-400" />} count={filterCatRows.length}>
          <PriceEditor kind="filterCategory" rows={filterCatRows} />
        </Section>
        <Section
          title="Filter price book"
          icon={<FilterIcon className="w-4 h-4 text-indigo-400" />}
          count={filterPriceRows.length}
          extra={
            <form className="flex items-center gap-1.5">
              <input name="fq" defaultValue={fq} placeholder="Search code / description" className="bg-[#121420] border border-white/5 rounded-lg px-2.5 py-1.5 text-white text-[11px] focus:outline-none focus:border-indigo-500/40" />
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-2.5 py-1.5"><Search className="w-3.5 h-3.5" /></button>
              {fq && <Link href="/admin/service-prices" className="text-[10px] text-gray-500 hover:text-white">Clear</Link>}
            </form>
          }
        >
          <PriceEditor kind="filterPrice" rows={filterPriceRows} />
          {!fq && <p className="text-[10px] text-gray-500 mt-2">Showing the first {filterPriceRows.length}. Search to find a specific filter.</p>}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon, count, extra, children }: { title: string; icon: React.ReactNode; count: number; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-[#1b1e30] border border-white/5 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">{icon} {title} <span className="text-gray-600 font-normal">({count})</span></h2>
        {extra}
      </div>
      {children}
    </div>
  );
}
