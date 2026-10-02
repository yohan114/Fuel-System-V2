import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { isMailConfigured } from "@/lib/mail";
import { Mail, ShieldCheck, AlertTriangle, Server, AtSign } from "lucide-react";
import { MailTestForm } from "./MailTestForm";

export default async function AdminMailPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const configured = isMailConfigured();
  const host = process.env.SMTP_HOST || "—";
  const port = process.env.SMTP_PORT || "—";
  const user = process.env.SMTP_USER || "—";
  const from = process.env.SMTP_FROM || "—";

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4">
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Mail className="w-5 h-5 text-indigo-400" /> Outbound Email & SMTP Settings
        </h1>
        <p className="text-xs text-gray-400 mt-1">
          Configure email delivery for customer invoice PDFs, management report dispatches, and urgent alert broadcasts.
        </p>
      </div>

      {/* Status Banner */}
      <div
        className={`p-5 rounded-2xl border flex items-center justify-between gap-4 ${
          configured
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
            : "bg-amber-500/10 border-amber-500/20 text-amber-300"
        }`}
      >
        <div className="flex items-center gap-3">
          {configured ? (
            <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />
          )}
          <div>
            <h3 className="text-sm font-bold text-white">
              {configured ? "SMTP Service Configured & Operational" : "SMTP Service Not Yet Configured"}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {configured
                ? "Environment variables are loaded and ready to dispatch email."
                : "Missing one or more required SMTP environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM)."}
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            configured
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
          }`}
        >
          {configured ? "READY" : "INCOMPLETE"}
        </span>
      </div>

      {/* Environment Config Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 space-y-1">
          <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider block">
            SMTP Host
          </span>
          <span className="text-sm font-bold text-white font-mono block truncate">
            {host}
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 space-y-1">
          <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider block">
            Port & Security
          </span>
          <span className="text-sm font-bold text-white font-mono block">
            {port} {port === "465" ? "(SSL/TLS)" : "(STARTTLS)"}
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 space-y-1">
          <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider block">
            Username / Sender
          </span>
          <span className="text-sm font-bold text-white font-mono block truncate">
            {user}
          </span>
        </div>

        <div className="bg-[#121420] border border-white/5 rounded-2xl p-4 space-y-1">
          <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider block">
            From Address
          </span>
          <span className="text-sm font-bold text-white font-mono block truncate">
            {from}
          </span>
        </div>
      </div>

      {/* Test Email Dispatcher */}
      <MailTestForm configured={configured} />
    </div>
  );
}
