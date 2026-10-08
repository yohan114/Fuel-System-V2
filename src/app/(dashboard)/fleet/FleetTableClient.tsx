"use client";

// ============================================================================
// Phase 3: Fleet Assets Virtualized Table Client Container
// Reference: Fuel-System-V3 Plan Section 8 (Phase 3 — High-Performance Frontend)
// Integrates TanStack Table & Virtual with URL-driven server pagination
// ============================================================================

import React, { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { VirtualizedDataTable } from "@/components/ui/virtualized-table/VirtualizedDataTable";
import type { FleetAssetRowItem } from "@/lib/fleet/query-assets";
import type { PaginationMeta, AllowedPageSize } from "@/lib/pagination/types";
import Link from "next/link";
import { Gauge, ArrowRight } from "lucide-react";

interface FleetTableClientProps {
  data: FleetAssetRowItem[];
  pagination: PaginationMeta;
  isAdmin: boolean;
}

export default function FleetTableClient({
  data,
  pagination,
  isAdmin,
}: FleetTableClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("page", String(newPage));
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const handleLimitChange = (newLimit: AllowedPageSize) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("limit", String(newLimit));
    params.set("page", "1"); // reset to page 1 on limit change
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const columns = useMemo<ColumnDef<FleetAssetRowItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: "E&C Number",
        size: 140,
        cell: ({ row }) => (
          <Link
            href={`/fleet/${row.original.code}`}
            className="font-bold text-white hover:text-indigo-400 tracking-wide transition-colors"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: "category.name",
        header: "Category",
        size: 160,
        cell: ({ row }) => (
          <span className="bg-white/5 border border-white/5 px-2 py-1 rounded-md text-[10px] font-semibold text-gray-300">
            {row.original.category.name}
          </span>
        ),
      },
      {
        accessorKey: "brand",
        header: "Brand / Model",
        size: 180,
        cell: ({ row }) => (
          <div>
            <span className="font-semibold text-white">{row.original.brand || "—"}</span>
            {row.original.model && (
              <span className="text-gray-500 ml-1.5">{row.original.model}</span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "regNo",
        header: "Registration No",
        size: 140,
        cell: ({ row }) => (
          <span className="text-gray-300 font-mono text-xs">
            {row.original.regNo || "—"}
          </span>
        ),
      },
      {
        accessorKey: "site",
        header: "Site Location",
        size: 150,
        cell: ({ row }) => (
          <span className="text-gray-400 text-xs">
            {row.original.site || "—"}
          </span>
        ),
      },
      {
        accessorKey: "meterType",
        header: "Meter Type",
        size: 130,
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5 text-gray-400 font-semibold text-xs">
            <Gauge className="w-3.5 h-3.5 text-gray-500" />
            {row.original.meterType}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        cell: ({ row }) => (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              row.original.status === "ACTIVE"
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
            }`}
          >
            {row.original.status}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        size: 120,
        cell: ({ row }) => (
          <div className="text-right">
            <Link
              href={`/fleet/${row.original.code}`}
              className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline inline-flex items-center gap-1 text-xs"
            >
              Inspect <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ),
      },
    ],
    []
  );

  return (
    <div className={`space-y-4 ${isPending ? "opacity-60 transition-opacity" : ""}`}>
      {/* Desktop Virtualized Data Table View */}
      <div className="hidden lg:block">
        <VirtualizedDataTable
          data={data}
          columns={columns}
          totalCount={pagination.totalCount}
          page={pagination.page}
          limit={pagination.limit}
          totalPages={pagination.totalPages}
          onPageChange={handlePageChange}
          onLimitChange={handleLimitChange}
          tableHeight={600}
          rowEstimateSize={52}
          emptyMessage="No fleet assets matching your criteria were found."
        />
      </div>

      {/* Mobile / Tablet Card View with Pagination Navigation */}
      <div className="lg:hidden space-y-4">
        {data.length === 0 ? (
          <div className="bg-[#121420] border border-white/5 rounded-2xl py-12 text-center text-sm text-gray-500">
            No fleet assets matching your criteria were found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.map((asset) => (
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
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold inline-flex items-center gap-1"
                  >
                    View Details <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mobile Pagination Bar */}
        {pagination.totalCount > 0 && (
          <div className="flex items-center justify-between bg-[#121420] border border-white/5 rounded-xl px-4 py-3 text-xs text-gray-400">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} assets)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevPage}
                className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white"
              >
                Prev
              </button>
              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNextPage}
                className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-white"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
