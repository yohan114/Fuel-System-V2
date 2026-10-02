"use client";

import React, { useState } from "react";
import { testSendMailAction } from "@/app/actions/mail";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export function MailTestForm({ configured }: { configured: boolean }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ type: "ok" | "err"; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await testSendMailAction(fd);
      if (res.error) {
        setResult({ type: "err", message: res.error });
      } else {
        setResult({ type: "ok", message: res.message || "Test email sent successfully!" });
      }
    } catch {
      setResult({ type: "err", message: "Failed to dispatch test email" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#121420] border border-white/5 rounded-2xl p-6 shadow-xl space-y-4">
      <h3 className="text-sm font-bold text-white tracking-wide border-b border-white/5 pb-3">
        Send Test Email
      </h3>

      {result && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2 text-xs border ${
            result.type === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          }`}
        >
          {result.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{result.message}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">
            Recipient Email Address
          </label>
          <input
            type="email"
            name="recipient"
            required
            placeholder="youremail@company.com"
            className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">Subject</label>
          <input
            type="text"
            name="subject"
            defaultValue="Fuel System V2 — SMTP Integration Test"
            className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-300 mb-1">
            Message Body
          </label>
          <textarea
            name="message"
            rows={3}
            defaultValue="This test confirms that Fuel System V2 can send notifications and invoice PDF attachments via your SMTP server."
            className="w-full bg-[#1b1e30] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send Test Email
          </button>
        </div>
      </form>
    </div>
  );
}
