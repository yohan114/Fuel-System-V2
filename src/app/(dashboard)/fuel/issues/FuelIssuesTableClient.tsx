"use client";

// ============================================================================
// Phase 3: Fuel Issues Virtualized Table Client Container
// Reference: Fuel-System-V3 Plan Section 8 (Phase 3 — High-Performance Frontend)
// Integrates TanStack Table & Virtual with URL-driven server pagination
// ============================================================================

import React, { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { VirtualizedDataTable } from "@/components/ui/virtualized-table/VirtualizedDataTable";
import type { FuelIssueRowItem } from "@/lib/fuel/query-issues";
import type { PaginationMeta, AllowedPageSize } from "@/lib/pagination/types";
import { fuelDateTime } from "@/lib/colombo-date";
import CorrectionButton from "./CorrectionButton";
import IssueAdminActions, { AdminIssueRow } from "./IssueAdminActions";
import { AlertCircle, Ban } from "lucide-react";

interface FuelIssuesTableClientProps {
  data: FuelIssueRowItem[];
  pagination: PaginationMeta;
  isAdmin: boolean;
  canCorrect: boolean;
}

export default function FuelIssuesTableClient({
  data,
  pagination,
  isAdmin,
  canCorrect,
}: FuelIssuesTableClientProps) {
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

  const columns = useMemo<ColumnDef<FuelIssueRowItem>[]>(
    () => [
      {
        accessorKey: "issueDate",
        header: "Date & Time",
        size: 160,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-slate-300">
            {fuelDateTime(row.original.issueDate)}
          </span>
        ),
      },
      {
        accessorKey: "asset.code",
        header: "Machine / Asset",
        size: 170,
        cell: ({ row }) => (
          <div>
            <div className="font-semibold text-slate-100 flex items-center gap-1.5">
              {row.original.asset.code}
              {row.original.voided && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 text-[10px] rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  <Ban className="h-2.5 w-2.5" /> VOID
                </span>
              )}
            </div>
            {row.original.asset.regNo && (
              <div className="text-[11px] text-slate-400 font-mono">
                {row.original.asset.regNo}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "litres",
        header: "Volume",
        size: 110,
        cell: ({ row }) => (
          <div className="font-mono text-sm font-semibold text-amber-400">
            {row.original.litres.toFixed(1)} L
          </div>
        ),
      },
      {
        accessorKey: "fuelKind",
        header: "Product",
        size: 130,
        cell: ({ row }) => {
          const isSuper = row.original.fuelKind === "SUPER_DIESEL";
          return (
            <span
              className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                isSuper
                  ? "bg-purple-900/40 text-purple-300 border border-purple-700/50"
                  : "bg-blue-900/40 text-blue-300 border border-blue-700/50"
              }`}
            >
              {row.original.fuelKind.replace("_", " ")}
            </span>
          );
        },
      },
      {
        accessorKey: "attributedSiteName",
        header: "Attributed Site",
        size: 170,
        cell: ({ row }) => {
          const site = row.original.attributedSiteName;
          return site ? (
            <span className="inline-block px-2 py-0.5 text-xs rounded bg-slate-800 text-slate-200 border border-slate-700 truncate max-w-[150px]">
              {site}
            </span>
          ) : (
            <span className="text-xs text-slate-500 italic">—</span>
          );
        },
      },
      {
        accessorKey: "bulkTank.name",
        header: "Dispensed From / Tank",
        size: 170,
        cell: ({ row }) => {
          const tank = row.original.bulkTank?.name;
          return (
            <div className="text-xs text-slate-300 truncate max-w-[150px]">
              {tank || (row.original.source === "BOWSER" ? "Mobile Bowser" : "Commercial Station")}
            </div>
          );
        },
      },
      {
        accessorKey: "issuedBy.name",
        header: "Issued By",
        size: 140,
        cell: ({ row }) => (
          <div className="text-xs text-slate-400 truncate max-w-[130px]">
            {row.original.issuedBy?.name || row.original.issuedBy?.username || "—"}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        size: 140,
        cell: ({ row }) => {
          const item = row.original;
          const adminRow: AdminIssueRow = {
            id: item.id,
            assetCode: item.asset.code,
            litres: item.litres,
            fuelKind: item.fuelKind,
            meterReading: item.meterReading,
            source: item.source,
            issueDate: item.issueDate instanceof Date ? item.issueDate.toISOString() : String(item.issueDate),
            voided: item.voided,
            bulkTankName: item.bulkTank?.name ?? null,
            tankLocked: Boolean(item.bulkTank),
          };

          return (
            <div className="flex items-center gap-1.5">
              {isAdmin && <IssueAdminActions issue={adminRow} historyCount={0} />}
              {canCorrect && !isAdmin && (
                <CorrectionButton
                  issue={{
                    id: item.id,
                    assetCode: item.asset.code,
                    litres: item.litres,
                    meterReading: item.meterReading,
                    readingType: item.readingType,
                    fuelKind: item.fuelKind,
                    issueDateISO: item.issueDate instanceof Date ? item.issueDate.toISOString() : String(item.issueDate),
                  }}
                />
              )}
              {item.correctionRequested && (
                <span title="Correction requested" className="text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                </span>
              )}
            </div>
          );
        },
      },
    ],
    [isAdmin, canCorrect]
  );

  return (
    <div className={`relative ${isPending ? "opacity-75 transition-opacity" : ""}`}>
      <VirtualizedDataTable<FuelIssueRowItem>
        data={data}
        columns={columns}
        totalCount={pagination.totalCount}
        page={pagination.page}
        limit={pagination.limit as AllowedPageSize}
        totalPages={pagination.totalPages}
        onPageChange={handlePageChange}
        onLimitChange={handleLimitChange}
        tableHeight={620}
        rowEstimateSize={52}
        emptyMessage="No fuel issues found matching the selected filters."
      />
    </div>
  );
}
