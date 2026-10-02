import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { billingScope } from "@/lib/roles";
import { ArrowLeft, Wallet, Receipt, CreditCard, Building2, Calendar } from "lucide-react";
import { RecordPaymentModal } from "./RecordPaymentModal";

interface PageProps {
  searchParams: Promise<{ month?: string; method?: string }>;
}

export default async function PaymentsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const scope = billingScope(session);
  if (scope.kind === "none") {
    return (
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-8 text-center">
        <p className="text-sm text-white font-semibold">Payments are not available for this login.</p>
        <p className="text-xs text-gray-400 mt-2">Visible to administrators and authorized site users.</p>
      </div>
    );
  }

  const isAdmin = session.role === "ADMIN";
  const searchParams = await props.searchParams;
  const methodFilter = searchParams.method || "ALL";

  const where: any = {};
  if (methodFilter !== "ALL") {
    where.method = methodFilter;
  }
  if (scope.kind === "project") {
    where.bill = { projectId: scope.projectId };
  }

  const [payments, unpaidInvoices] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        bill: {
          select: {
            id: true,
            invoiceNumber: true,
            assetCode: true,
            projectName: true,
            year: true,
            month: true,
            grandTotalCents: true,
            status: true,
          },
        },
      },
      orderBy: { paidDate: "desc" },
      take: 200,
    }),
    isAdmin
      ? prisma.bill.findMany({
          where: {
            status: { in: ["ISSUED", "OVERDUE"] },
          },
          select: {
            id: true,
            invoiceNumber: true,
            assetCode: true,
            projectName: true,
            grandTotalCents: true,
            paidAmountCents: true,
          },
          orderBy: { createdAt: "desc" },
          take: 150,
        })
      : Promise.resolve([]),
  ]);

  const totalCollectedCents = payments.reduce((sum, p) => sum + p.amountCents, 0);

  // Group by payment method
  const methods = ["ALL", "Bank Transfer", "Cheque", "Cash", "Online"];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/billing" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Invoices
            </Link>
            <span>/</span>
            <span className="text-white font-medium">Payments</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-emerald-400" /> Payments Ledger
          </h1>
          <p className="text-xs text-gray-400">
            Historical ledger of all payments and receipts booked against invoices.
          </p>
        </div>

        {isAdmin && <RecordPaymentModal unpaidInvoices={unpaidInvoices} />}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 bg-[#121420] rounded-xl px-2 py-1 gap-2">
        <Link
          href="/billing"
          className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg transition-all"
        >
          Invoices
        </Link>
        <Link
          href="/billing/aging"
          className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg transition-all"
        >
          Aging Report
        </Link>
        <Link
          href="/billing/credit-notes"
          className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg transition-all"
        >
          Credit Notes
        </Link>
        <Link
          href="/billing/payments"
          className="px-4 py-2 text-xs font-semibold bg-emerald-600/20 text-emerald-400 rounded-lg transition-all border border-emerald-500/20"
        >
          Payments Ledger
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Total Payments Recorded
          </span>
          <span className="text-lg font-bold text-emerald-400 block mt-1">
            Rs. {(totalCollectedCents / 100).toLocaleString("en-LK")}
          </span>
          <span className="text-[10px] text-gray-500 block mt-0.5">
            {payments.length} payment transaction(s)
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Unpaid Invoices Awaiting Settlement
          </span>
          <span className="text-lg font-bold text-amber-400 block mt-1">
            {unpaidInvoices.length} invoices
          </span>
          <span className="text-[10px] text-gray-500 block mt-0.5">
            Issued or overdue status
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Filter by Method
          </span>
          <div className="flex gap-1.5 flex-wrap mt-2">
            {methods.map((m) => (
              <Link
                key={m}
                href={`/billing/payments?method=${encodeURIComponent(m)}`}
                className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold transition-all ${
                  methodFilter === m
                    ? "bg-emerald-600 text-white"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Payments Table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        {payments.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-500">
            No payments recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-5 py-3 font-semibold">Payment Date</th>
                  <th className="px-5 py-3 font-semibold">Invoice #</th>
                  <th className="px-5 py-3 font-semibold">Asset / Site</th>
                  <th className="px-5 py-3 font-semibold">Method</th>
                  <th className="px-5 py-3 font-semibold">Reference</th>
                  <th className="px-5 py-3 font-semibold">Note</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount Received</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-white whitespace-nowrap font-medium">
                      {new Date(p.paidDate).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/billing/${p.bill.id}`}
                        className="font-semibold text-indigo-400 hover:text-indigo-300 block"
                      >
                        {p.bill.invoiceNumber || p.bill.assetCode}
                      </Link>
                      <span className="text-[10px] text-gray-500 block">
                        Period: {p.bill.year}-{String(p.bill.month).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-gray-200 font-medium">{p.bill.assetCode}</span>
                      <span className="text-[10px] text-gray-500 block">{p.bill.projectName || "Unassigned"}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">
                      <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-medium text-gray-300">
                        {p.method || "Cash"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 font-mono text-[11px]">
                      {p.reference || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-400 max-w-xs truncate" title={p.note || ""}>
                      {p.note || "—"}
                    </td>
                    <td className="px-5 py-3 font-bold text-emerald-400 text-right whitespace-nowrap text-sm">
                      Rs. {(p.amountCents / 100).toLocaleString("en-LK")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
