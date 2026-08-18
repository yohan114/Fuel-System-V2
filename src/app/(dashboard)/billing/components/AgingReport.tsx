import React from "react";
import { prisma } from "@/lib/db";
import { Clock } from "lucide-react";

function rs(cents: number) {
  return "Rs. " + (cents / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 });
}

interface Bucket {
  label: string;
  count: number;
  cents: number;
  cls: string;
}

// Receivables aging across ALL months (not just the filtered one). Buckets
// unpaid ISSUED / OVERDUE invoices by how many days past their due date they
// are. Scoped to a single project when projectId is provided (USER role).
export default async function AgingReport({ projectId }: { projectId?: string | null }) {
  const where: any = { status: { in: ["ISSUED", "OVERDUE"] } };
  if (projectId) where.projectId = projectId;

  const bills = await prisma.bill.findMany({
    where,
    select: { grandTotalCents: true, dueDate: true },
  });

  if (bills.length === 0) return null;

  const now = Date.now();
  const buckets: Bucket[] = [
    { label: "Current (not due)", count: 0, cents: 0, cls: "text-emerald-400" },
    { label: "1–30 days", count: 0, cents: 0, cls: "text-amber-400" },
    { label: "31–60 days", count: 0, cents: 0, cls: "text-orange-400" },
    { label: "61–90 days", count: 0, cents: 0, cls: "text-red-400" },
    { label: "90+ days", count: 0, cents: 0, cls: "text-red-500" },
  ];

  for (const b of bills) {
    const dueMs = b.dueDate ? new Date(b.dueDate).getTime() : now;
    const daysOver = Math.floor((now - dueMs) / (24 * 60 * 60 * 1000));
    let idx: number;
    if (daysOver <= 0) idx = 0;
    else if (daysOver <= 30) idx = 1;
    else if (daysOver <= 60) idx = 2;
    else if (daysOver <= 90) idx = 3;
    else idx = 4;
    buckets[idx].count++;
    buckets[idx].cents += b.grandTotalCents;
  }

  const totalOutstanding = buckets.reduce((s, x) => s + x.cents, 0);

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          Receivables Aging
        </h3>
        <span className="text-xs text-gray-400">
          Outstanding: <span className="text-white font-bold">{rs(totalOutstanding)}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {buckets.map((bk) => (
          <div key={bk.label} className="bg-white/5 border border-white/5 rounded-xl p-3">
            <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">{bk.label}</div>
            <div className={`text-base font-bold mt-1 ${bk.cents > 0 ? bk.cls : "text-gray-600"}`}>{rs(bk.cents)}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">{bk.count} invoice{bk.count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
