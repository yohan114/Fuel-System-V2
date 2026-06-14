import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import Link from "next/link";
import { Search, Filter, Car, Gauge, Plus } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string }>;
}

export default async function FleetPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;
  const q = searchParams.q || "";
  const categoryCode = searchParams.category || "";

  // 1. Fetch categories for filters
  const categories = await prisma.category.findMany({
    orderBy: { code: "asc" },
  });

  // 2. Build where clause
  const where: any = {
    status: {
      in: ["ACTIVE", "INACTIVE"], // Excluding DISPOSED assets by default
    },
    ...(session.role === "USER" && session.projectId ? {
      projectId: session.projectId
    } : {}),
  };

  if (categoryCode) {
    where.category = {
      code: categoryCode,
    };
  }

  if (q) {
    where.OR = [
      { code: { contains: q } },
      { brand: { contains: q } },
      { model: { contains: q } },
      { regNo: { contains: q } },
      { site: { contains: q } },
    ];
  }

  // 3. Query matching assets
  const assets = await prisma.asset.findMany({
    where,
    include: {
      category: true,
    },
    orderBy: {
      code: "asc",
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">Fleet Directory</h1>
          <p className="text-xs text-gray-400 mt-1">
            Displaying {assets.length} assets. Manage, inspect specifications, and verify running efficiency logs.
          </p>
        </div>
        
        {session.role === "ADMIN" && (
          <Link
            href="/fleet/new"
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-semibold tracking-wide shadow-md hover:shadow-indigo-500/10 active:scale-95 transition-all w-fit"
          >
            <Plus className="w-4 h-4" />
            Add New Asset
          </Link>
        )}
      </div>

      {/* Filters Form Container */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 md:p-6 shadow-lg">
        <form method="GET" action="/fleet" className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search bar */}
          <div className="md:col-span-2 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by asset code, registration plate, brand, site..."
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl pl-11 pr-4 py-3 text-white placeholder-gray-500 text-xs focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          {/* Category Dropdown */}
          <div>
            <select
              name="category"
              defaultValue={categoryCode}
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white text-xs focus:outline-none focus:border-indigo-500/50"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.code}>
                  {cat.code} - {cat.name} ({cat.defaultMeterType})
                </option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl py-3 active:scale-95 transition-all shadow-md"
            >
              Filter List
            </button>
            <Link
              href="/fleet"
              className="px-4 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-semibold flex items-center justify-center border border-white/5 active:scale-95 transition-all"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      {/* Category Pills/Tabs quick filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-white/5">
        <Link
          href="/fleet"
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all ${
            categoryCode === ""
              ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              : "bg-white/5 text-gray-400 hover:text-white border border-transparent"
          }`}
        >
          All ({assets.length})
        </Link>
        {categories.map((cat) => {
          const isActive = categoryCode === cat.code;
          return (
            <Link
              key={cat.id}
              href={`/fleet?category=${cat.code}&q=${q}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition-all ${
                isActive
                  ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                  : "bg-white/5 text-gray-400 hover:text-white border border-transparent"
              }`}
            >
              {cat.code}
            </Link>
          );
        })}
      </div>

      {/* Assets Grid / Table */}
      {assets.length === 0 ? (
        <div className="bg-[#121420] border border-white/5 rounded-2xl py-16 text-center text-sm text-gray-500">
          No fleet assets matching your criteria were found.
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden lg:block bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="bg-white/5 text-gray-400 border-b border-white/5">
                  <th className="px-6 py-4 font-semibold">E&C Number</th>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold">Brand / Model</th>
                  <th className="px-6 py-4 font-semibold">Registration No</th>
                  <th className="px-6 py-4 font-semibold">Site Location</th>
                  <th className="px-6 py-4 font-semibold">Meter Type</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {assets.map((asset) => (
                  <tr
                    key={asset.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-4">
                      <Link
                        href={`/fleet/${asset.code}`}
                        className="font-bold text-white hover:text-indigo-400 tracking-wide transition-colors"
                      >
                        {asset.code}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      <span className="bg-white/5 border border-white/5 px-2 py-1 rounded-md text-[10px] font-semibold text-gray-300">
                        {asset.category.name}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-white">{asset.brand || "—"}</span>
                      <span className="text-gray-500 ml-1.5">{asset.model || ""}</span>
                    </td>
                    <td className="px-6 py-4 text-gray-300 font-mono">
                      {asset.regNo || "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-400">
                      {asset.site || "—"}
                    </td>
                    <td className="px-6 py-4 text-gray-400 font-semibold">
                      <span className="flex items-center gap-1.5">
                        <Gauge className="w-3.5 h-3.5 text-gray-500" />
                        {asset.meterType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/fleet/${asset.code}`}
                        className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline"
                      >
                        Inspect Details &rarr;
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:hidden gap-4">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="bg-[#121420] border border-white/5 rounded-2xl p-5 shadow-lg flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/fleet/${asset.code}`}
                      className="text-base font-bold text-white hover:text-indigo-400 tracking-wide"
                    >
                      {asset.code}
                    </Link>
                    <span className="bg-indigo-500/10 border border-indigo-500/10 text-indigo-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase">
                      {asset.category.code}
                    </span>
                  </div>

                  <p className="text-xs text-white font-semibold mt-2">
                    {asset.brand || "—"} {asset.model || ""}
                  </p>
                  <p className="text-xs text-gray-400 font-mono mt-1">
                    Reg: {asset.regNo || "—"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Site: {asset.site || "—"}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-1">
                  <span className="text-xs text-gray-400 font-semibold flex items-center gap-1">
                    <Gauge className="w-3.5 h-3.5 text-gray-500" />
                    {asset.meterType}
                  </span>
                  <Link
                    href={`/fleet/${asset.code}`}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold"
                  >
                    View Details &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
