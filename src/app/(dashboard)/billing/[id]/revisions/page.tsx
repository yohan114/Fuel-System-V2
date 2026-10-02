import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  parseBillSnapshot,
  buildBillSnapshot,
  summarizeRevisionDiff,
  type BillSnapshot,
} from "@/lib/billing/revisions";
import {
  ArrowLeft,
  History,
  FileText,
  AlertCircle,
  Clock,
  ArrowRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

function money(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function BillRevisionsPage(props: PageProps) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await props.params;

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      asset: { select: { id: true, code: true, regNo: true } },
      lineItems: true,
      revisions: {
        orderBy: { revision: "desc" },
      },
    },
  });

  if (!bill) notFound();

  const currentSnapshot: BillSnapshot = buildBillSnapshot(bill, bill.lineItems);

  // Parse all historical revisions
  const revisionItems = bill.revisions.map((rev, index) => {
    const prevSnapshot = parseBillSnapshot(rev.snapshotJson);
    const nextSnapshot =
      index === 0
        ? currentSnapshot
        : parseBillSnapshot(bill.revisions[index - 1].snapshotJson);

    const diffs =
      prevSnapshot && nextSnapshot
        ? summarizeRevisionDiff(prevSnapshot, nextSnapshot)
        : [];

    return {
      revision: rev.revision,
      createdAt: rev.createdAt,
      reason: rev.reason,
      subtotalCents: rev.subtotalCents,
      grandTotalCents: rev.grandTotalCents,
      snapshot: prevSnapshot,
      diffs,
    };
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href={`/billing/${id}`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Invoice {bill.invoiceNumber || `(${bill.periodKey})`}</span>
        </Link>
      </div>

      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full">
                {bill.periodKey}
              </span>
              <span className="text-xs text-slate-400">
                {bill.status}
              </span>
            </div>
            <h1 className="text-2xl font-extrabold text-white mt-2">
              Invoice Revision History
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Vehicle {bill.asset.code} • {bill.projectName || "Site Billing"}
            </p>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wider">
              Current Grand Total
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {money(bill.grandTotalCents)}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline of Revisions */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <History className="w-4 h-4 text-blue-400" />
          <span>Prior Versions ({revisionItems.length})</span>
        </h2>

        {revisionItems.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-500 text-xs">
            No revisions recorded for this invoice yet. It is in its original generated state.
          </div>
        ) : (
          <div className="space-y-4">
            {revisionItems.map((rev) => (
              <div
                key={rev.revision}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-white">
                        Revision #{rev.revision}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {new Date(rev.createdAt).toLocaleString("en-GB")}
                      </span>
                    </div>
                    {rev.reason && (
                      <div className="text-xs text-slate-400 mt-1 italic">
                        Reason: &quot;{rev.reason}&quot;
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-500">Historical Total</div>
                    <div className="font-mono font-bold text-white text-base">
                      {money(rev.grandTotalCents)}
                    </div>
                  </div>
                </div>

                {/* Diff Summary */}
                {rev.diffs.length > 0 && (
                  <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/80 text-xs space-y-1.5">
                    <div className="text-slate-400 font-semibold mb-1">
                      Changes introduced after Revision #{rev.revision}:
                    </div>
                    {rev.diffs.map((diff, i) => (
                      <div
                        key={i}
                        className="text-slate-300 font-mono text-[11px] flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        <span>{diff}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Snapshot Breakdown */}
                {rev.snapshot && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
                    <div>
                      <span>Rental:</span>{" "}
                      <span className="font-mono text-slate-200">
                        {money(rev.snapshot.rentalAmountCents)}
                      </span>
                    </div>
                    <div>
                      <span>Fuel:</span>{" "}
                      <span className="font-mono text-slate-200">
                        {money(rev.snapshot.fuelCostCents)} ({rev.snapshot.fuelLitres.toFixed(1)}L)
                      </span>
                    </div>
                    <div>
                      <span>Billable Units:</span>{" "}
                      <span className="font-mono text-slate-200">
                        {rev.snapshot.billableUnits.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span>Rate Mode:</span>{" "}
                      <span className="font-mono text-slate-200">
                        {rev.snapshot.billingMode}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
