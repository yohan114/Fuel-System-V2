"use client";

// ============================================================================
// Phase 3: High-Performance Enterprise Virtualized Data Table
// Reference: Fuel-System-V3 Plan Section 8 (Phase 3 — High-Performance Frontend)
// Built with TanStack Table + TanStack Virtual for 60fps windowed rendering
// ============================================================================

import React, { useRef } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
} from "lucide-react";
import { ALLOWED_PAGE_SIZES, type AllowedPageSize } from "@/lib/pagination/types";

export interface VirtualizedDataTableProps<TData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
  onLimitChange: (newLimit: AllowedPageSize) => void;
  onSearchChange?: (query: string) => void;
  searchQuery?: string;
  searchPlaceholder?: string;
  tableHeight?: number;
  rowEstimateSize?: number;
  emptyMessage?: string;
}

export function VirtualizedDataTable<TData>({
  data,
  columns,
  totalCount,
  page,
  limit,
  totalPages,
  onPageChange,
  onLimitChange,
  onSearchChange,
  searchQuery = "",
  searchPlaceholder = "Search records...",
  tableHeight = 600,
  rowEstimateSize = 52,
  emptyMessage = "No matching records found.",
}: VirtualizedDataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => rowEstimateSize,
    overscan: 10,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();

  const startRecord = totalCount === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, totalCount);

  return (
    <div className="flex flex-col w-full rounded-xl border border-slate-700/60 bg-slate-900/80 shadow-xl overflow-hidden backdrop-blur-md">
      {/* Table Toolbar / Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-b border-slate-700/60 bg-slate-800/40">
        {onSearchChange ? (
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-950/70 border border-slate-700/80 rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
          </div>
        ) : (
          <div />
        )}

        {/* Page Size Selector */}
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="font-medium text-slate-400">Rows per page:</span>
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value) as AllowedPageSize)}
            className="bg-slate-950/80 border border-slate-700/80 rounded-md px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {ALLOWED_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Virtualized Table Container */}
      <div
        ref={tableContainerRef}
        style={{ height: `${tableHeight}px` }}
        className="w-full overflow-auto relative scrollbar-thin scrollbar-thumb-slate-700"
      >
        <table className="w-full border-collapse text-left text-sm">
          {/* Sticky Header */}
          <thead className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 text-xs font-semibold uppercase tracking-wider text-slate-300">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-slate-300 font-semibold"
                    style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {/* Virtualized Body */}
          {rows.length === 0 ? (
            <tbody>
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-sm text-slate-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody
              style={{
                height: `${totalVirtualSize}px`,
                position: "relative",
              }}
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={`flex items-center border-b border-slate-800/80 transition-colors hover:bg-slate-800/50 ${
                      virtualRow.index % 2 === 0 ? "bg-slate-900/30" : "bg-slate-900/70"
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-4 py-2 truncate text-slate-200"
                        style={{ width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-700/60 bg-slate-800/40 text-xs text-slate-300">
        <div className="text-slate-400">
          Showing <span className="font-semibold text-slate-200">{startRecord.toLocaleString()}</span> to{" "}
          <span className="font-semibold text-slate-200">{endRecord.toLocaleString()}</span> of{" "}
          <span className="font-semibold text-slate-200">{totalCount.toLocaleString()}</span> records
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(1)}
            disabled={page <= 1}
            title="First Page"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            title="Previous Page"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="px-3 py-1 text-slate-200 font-medium">
            Page {page} of {totalPages}
          </span>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            title="Next Page"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={page >= totalPages}
            title="Last Page"
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
