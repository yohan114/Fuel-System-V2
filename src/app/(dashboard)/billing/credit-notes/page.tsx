import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { billingScope } from "@/lib/roles";
import { ArrowLeft, Receipt, CheckCircle, Clock, FileText, Ban } from "lucide-react";
import { IssueCreditNoteButton, CreateCreditNoteModal } from "./CreditNoteActions";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function CreditNotesPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const scope = billingScope(session);
  if (scope.kind === "none") {
    return (
      <div className="bg-[#121420] border border-white/5 rounded-2xl p-8 text-center">
        <p className="text-sm text-white font-semibold">Credit notes are not available for this login.</p>
        <p className="text-xs text-gray-400 mt-2">Visible to administrators and site users.</p>
      </div>
    );
  }

  const isAdmin = session.role === "ADMIN";
  const searchParams = await props.searchParams;
  const statusFilter = searchParams.status || "ALL";

  const where: any = {};
  if (statusFilter !== "ALL") {
    where.status = statusFilter;
  }
  if (scope.kind === "project") {
    where.bill = { projectId: scope.projectId };
  }

  const [creditNotes, issuedInvoices] = await Promise.all([
    prisma.creditNote.findMany({
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
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    isAdmin
      ? prisma.bill.findMany({
          where: { status: { in: ["ISSUED", "OVERDUE", "PAID"] } },
          select: { id: true, invoiceNumber: true, assetCode: true, grandTotalCents: true },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const totalCreditedCents = creditNotes
    .filter((c) => c.status === "ISSUED")
    .reduce((sum, c) => sum + c.amountCents, 0);

  const draftCreditedCents = creditNotes
    .filter((c) => c.status === "DRAFT")
    .reduce((sum, c) => sum + c.amountCents, 0);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Nav */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/billing" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Invoices
            </Link>
            <span>/</span>
            <span className="text-white font-medium">Credit Notes</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" /> Credit Notes
          </h1>
          <p className="text-xs text-gray-400">
            Issued and draft credit notes applied against billing invoices.
          </p>
        </div>

        {isAdmin && <CreateCreditNoteModal issuedInvoices={issuedInvoices} />}
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
          className="px-4 py-2 text-xs font-semibold bg-indigo-600/20 text-indigo-400 rounded-lg transition-all border border-indigo-500/20"
        >
          Credit Notes
        </Link>
        <Link
          href="/billing/payments"
          className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-lg transition-all"
        >
          Payments Ledger
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Total Issued Credits
          </span>
          <span className="text-lg font-bold text-emerald-400 block mt-1">
            Rs. {(totalCreditedCents / 100).toLocaleString("en-LK")}
          </span>
          <span className="text-[10px] text-gray-500 block mt-0.5">
            {creditNotes.filter((c) => c.status === "ISSUED").length} credit note(s) issued
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Draft Credits Pending
          </span>
          <span className="text-lg font-bold text-amber-400 block mt-1">
            Rs. {(draftCreditedCents / 100).toLocaleString("en-LK")}
          </span>
          <span className="text-[10px] text-gray-500 block mt-0.5">
            {creditNotes.filter((c) => c.status === "DRAFT").length} draft(s) awaiting approval
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
            Filter by Status
          </span>
          <div className="flex gap-2 mt-2">
            {["ALL", "DRAFT", "ISSUED"].map((st) => (
              <Link
                key={st}
                href={`/billing/credit-notes?status=${st}`}
                className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                  statusFilter === st
                    ? "bg-indigo-600 text-white"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {st}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Credit Notes Table */}
      <div className="bg-[#121420] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        {creditNotes.length === 0 ? (
          <div className="p-12 text-center text-xs text-gray-500">
            No credit notes found for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-gray-400 uppercase tracking-wider text-[10px] border-b border-white/5">
                <tr>
                  <th className="px-5 py-3 font-semibold">Credit Note #</th>
                  <th className="px-5 py-3 font-semibold">Invoice / Asset</th>
                  <th className="px-5 py-3 font-semibold">Site</th>
                  <th className="px-5 py-3 font-semibold">Reason</th>
                  <th className="px-5 py-3 font-semibold text-right">Amount</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  {isAdmin && <th className="px-5 py-3 font-semibold text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {creditNotes.map((cn) => (
                  <tr key={cn.id} className="hover:bg-white/[0.02]">
                    <td className="px-5 py-3 font-semibold text-white whitespace-nowrap">
                      {cn.number || <span className="text-gray-500 italic">DRAFT</span>}
                    </td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/billing/${cn.bill.id}`}
                        className="font-medium text-indigo-400 hover:text-indigo-300 block"
                      >
                        {cn.bill.invoiceNumber || cn.bill.assetCode}
                      </Link>
                      <span className="text-[10px] text-gray-500 block">
                        Period: {cn.bill.year}-{String(cn.bill.month).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-300">
                      {cn.bill.projectName || "—"}
                    </td>
                    <td className="px-5 py-3 text-gray-300 max-w-xs truncate" title={cn.reason}>
                      {cn.reason}
                    </td>
                    <td className="px-5 py-3 font-bold text-white text-right whitespace-nowrap">
                      Rs. {(cn.amountCents / 100).toLocaleString("en-LK")}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                          cn.status === "ISSUED"
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                            : "bg-amber-500/10 border-amber-500/20 text-amber-400"
                        }`}
                      >
                        {cn.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                      {cn.issuedDate
                        ? new Date(cn.issuedDate).toLocaleDateString("en-GB")
                        : new Date(cn.createdAt).toLocaleDateString("en-GB")}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right">
                        {cn.status === "DRAFT" ? (
                          <IssueCreditNoteButton creditNoteId={cn.id} />
                        ) : (
                          <span className="text-[10px] text-gray-500 flex items-center justify-end gap-1">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> Settled
                          </span>
                        )}
                      </td>
                    )}
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
