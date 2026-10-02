import React from "react";
import { getSession, loadCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Fuel, PlusCircle, Gauge, Activity, Home, ArrowUpRight, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const user = await loadCurrentUser();
  if (!user || !user.active) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500 selection:text-white">
      {/* Mobile Top App Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20">
            <Fuel className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              <span>Fuel App</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                PUMP
              </span>
            </div>
            <div className="text-[11px] text-slate-400 leading-none">
              {user.name} • {user.role}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="text-xs px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1 transition-colors border border-slate-700/60"
            title="Desktop Dashboard"
          >
            <span>Portal</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
          </Link>
          <form action={logoutAction}>
            <button
              type="submit"
              className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 pb-24 px-3 py-3 max-w-lg mx-auto w-full">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 px-2 py-2 flex items-center justify-around shadow-lg">
        <Link
          href="/m"
          className="flex flex-col items-center justify-center w-14 py-1 text-slate-400 hover:text-blue-400 active:scale-95 transition-all text-[11px]"
        >
          <Home className="w-5 h-5 mb-0.5" />
          <span>Home</span>
        </Link>

        <Link
          href="/m/issue"
          className="flex flex-col items-center justify-center w-14 py-1 text-blue-400 font-medium active:scale-95 transition-all text-[11px]"
        >
          <div className="relative">
            <Fuel className="w-5 h-5 mb-0.5" />
            <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          </div>
          <span>Issue</span>
        </Link>

        <Link
          href="/m/request"
          className="flex flex-col items-center justify-center w-14 py-1 text-slate-400 hover:text-blue-400 active:scale-95 transition-all text-[11px]"
        >
          <PlusCircle className="w-5 h-5 mb-0.5" />
          <span>Request</span>
        </Link>

        <Link
          href="/m/readings"
          className="flex flex-col items-center justify-center w-14 py-1 text-slate-400 hover:text-blue-400 active:scale-95 transition-all text-[11px]"
        >
          <Gauge className="w-5 h-5 mb-0.5" />
          <span>Readings</span>
        </Link>

        <Link
          href="/m/condition"
          className="flex flex-col items-center justify-center w-14 py-1 text-slate-400 hover:text-blue-400 active:scale-95 transition-all text-[11px]"
        >
          <Activity className="w-5 h-5 mb-0.5" />
          <span>Status</span>
        </Link>
      </nav>
    </div>
  );
}
