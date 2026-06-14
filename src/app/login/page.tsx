"use client";

import React, { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Fuel, ShieldAlert } from "lucide-react";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[#090a0f] overflow-hidden px-4">
      {/* Background radial glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/4 left-1/3 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main card with glassmorphism */}
      <div className="relative w-full max-w-md bg-[#121420]/80 backdrop-blur-xl border border-white/5 rounded-2xl shadow-2xl p-8 transition-all duration-300 hover:border-white/10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4 transform hover:rotate-12 transition-transform duration-300">
            <Fuel className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-wide">E&C Fuel Portal</h1>
          <p className="text-sm text-gray-400 mt-1">Edward & Christie Fleet Management</p>
        </div>

        {state?.error && (
          <div className="flex items-center gap-3 bg-red-500/15 border border-red-500/20 rounded-xl p-4 mb-6 animate-shake">
            <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-200">{state.error}</span>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Username
            </label>
            <input
              type="text"
              name="username"
              required
              placeholder="e.g. admin"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••"
              className="w-full bg-[#1b1e30] border border-white/5 rounded-xl px-4 py-3 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold tracking-wide shadow-lg shadow-indigo-500/25 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center"
          >
            {isPending ? (
              <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-gray-500 border-t border-white/5 pt-6">
          Authorized personnel only. Logs are active.
        </div>
      </div>
    </div>
  );
}
