import React from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stockTakeStatus, currentPeriod } from "@/lib/stock/queries";
import { ClipboardCheck, AlertTriangle } from "lucide-react";
import StockTakeRow from "./StockTakeRow";

function prevPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export default async function StockTakePage(props: { searchParams: Promise<{ period?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "STOREKEEPER") redirect("/");

  const sp = await props.searchParams;
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : currentPeriod();

  const rows = await stockTakeStatus(period);

  // Overdue notice: previous month's count not done within 7 days of month-end.
  const prev = prevPeriod(currentPeriod());
  const prevCounts = await prisma.stockCount.count({ where: { period: prev } });
  const dayOfMonth = new Date().getUTCDate();
  const overdue = prevCounts === 0 && dayOfMonth > 7;

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-indigo-400" /> Stock Take
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Record the physical count per product, see the variance vs the book, and post an adjustment so the book matches reality.
          </p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <input type="month" name="period" defaultValue={period} className="bg-[#1b1e30] border border-white/5 rounded-xl px-3 py-2 text-white text-xs" />
          <button type="submit" className="bg-white/5 hover:bg-white/10 text-white text-xs font-semibold rounded-xl px-3 py-2">Go</button>
        </form>
      </div>

      {overdue && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-center gap-3 text-red-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Last month&apos;s stock take ({prev}) is overdue — record it to keep the book reconciled.
        </div>
      )}

      <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 md:p-6 shadow-xl overflow-x-auto">
        <h2 className="text-sm font-bold text-white mb-4">Count for {period}</h2>
        {rows.length === 0 ? (
          <div className="text-center py-12 text-xs text-gray-500">No active products to count.</div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-gray-400 font-semibold border-b border-white/5">
                <th className="py-2.5">Product</th>
                <th className="py-2.5 text-right">Book qty</th>
                <th className="py-2.5 text-right">Counted</th>
                <th className="py-2.5 text-right">Variance</th>
                <th className="py-2.5 text-center">Adjust</th>
                <th className="py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <StockTakeRow
                  key={r.productId}
                  productId={r.productId}
                  period={period}
                  name={r.name}
                  unit={r.unit}
                  bookQty={r.bookQty}
                  countedQty={r.countedQty}
                  variance={r.variance}
                  adjusted={r.adjusted}
                />
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">Tick &ldquo;adjust&rdquo; to post an ADJUSTMENT movement that makes the book balance equal your count.</p>
      </div>
    </div>
  );
}
