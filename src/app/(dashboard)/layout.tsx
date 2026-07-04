import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { 
  Fuel, 
  LayoutDashboard, 
  Car, 
  FileCheck, 
  FileText, 
  Gauge,
  Settings,
  LogOut,
  Menu,
  Database,
  Receipt,
  Wrench,
  ShieldAlert,
  Droplets,
  Bell,
  Activity,
  ScrollText,
  DatabaseZap,
  Wallet,
  Target,
  Building2,
  AlertTriangle,
  Filter as FilterIcon
} from "lucide-react";

import { prisma } from "@/lib/db";

interface LayoutProps {
  children: React.ReactNode;
}

export default async function DashboardLayout({ children }: LayoutProps) {
  const session = await getSession();
  
  if (!session) {
    redirect("/login");
  }

  // Verify that the user still exists in the database (e.g. after a DB reset)
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  if (!user || !user.active) {
    redirect("/login");
  }

  const isAdmin = session.role === "ADMIN";
  const isAllocator = session.role === "ALLOCATOR";
  const isWorkshop = session.role === "WORKSHOP";
 
  let navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
  ];

  if (isAdmin) {
    navItems.push(
      { label: "Allocator Console", href: "/allocator", icon: Car },
      { label: "Workshop Console", href: "/workshop", icon: Database },
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Fuel Integrity", href: "/integrity", icon: ShieldAlert },
      { label: "Tank Reconciliation", href: "/admin/tanks", icon: Droplets },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Reports Console", href: "/reports", icon: FileCheck },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Alerts", href: "/alerts", icon: Bell },
      { label: "Receivables", href: "/billing/aging", icon: Wallet },
      { label: "Fuel Budgets", href: "/admin/budgets", icon: Target },
      { label: "Audit Log", href: "/admin/audit", icon: ScrollText },
      { label: "Data Quality", href: "/admin/data-quality", icon: DatabaseZap }
    );
  } else if (isAllocator) {
    navItems.push(
      { label: "Allocator Console", href: "/allocator", icon: Car },
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Reports Console", href: "/reports", icon: FileCheck },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Alerts", href: "/alerts", icon: Bell }
    );
  } else if (isWorkshop) {
    navItems.push(
      { label: "Workshop Console", href: "/workshop", icon: Database },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon }
    );
  } else {
    // USER role
    navItems.push(
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Reports Console", href: "/reports", icon: FileCheck },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Receivables", href: "/billing/aging", icon: Wallet },
      { label: "Alerts", href: "/alerts", icon: Bell }
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#090a0f] text-gray-200">
      
      {/* 1. Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-[#121420] border-r border-white/5 p-6 flex-shrink-0">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3 mb-10 px-2">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/10">
            <Fuel className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-white tracking-wide text-md">E&C Fuel</h1>
            <p className="text-[10px] text-gray-500 font-semibold uppercase">Management</p>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}

          {/* Admin Section */}
          {isAdmin && (
            <div className="pt-6 mt-6 border-t border-white/5 space-y-1">
              <p className="px-4 text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                System Admin
              </p>
              <Link
                href="/admin/prices"
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <Settings className="w-5 h-5" />
                Admin Console
              </Link>
            </div>
          )}
        </nav>

        {/* User Card & Logout */}
        <div className="border-t border-white/5 pt-6 mt-6 flex flex-col gap-4">
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center font-bold text-indigo-400 border border-indigo-500/10">
              {session.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-white truncate">{session.name}</p>
              <p className="text-xs text-gray-500 font-medium capitalize">{session.role.toLowerCase()}</p>
            </div>
          </div>
          
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/5 transition-all"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </form>
        </div>
      </aside>

      {/* 2. Mobile Header */}
      <header className="md:hidden flex items-center justify-between bg-[#121420] border-b border-white/5 px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-lg flex items-center justify-center">
            <Fuel className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white tracking-wide text-sm">E&C Fuel</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-xs font-bold text-indigo-400">
            {session.name.substring(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      {/* 3. Main Workspace Area */}
      <main className="flex-1 overflow-y-auto p-6 md:p-10 pb-24 md:pb-10">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* 4. Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#121420]/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-around py-3 z-50">
        {navItems.slice(0, 4).map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1 text-gray-400 hover:text-white"
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
        {isAdmin ? (
          <Link
            href="/admin/prices"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-white"
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-medium">Admin</span>
          </Link>
        ) : (
          <Link
            href="/readings"
            className="flex flex-col items-center gap-1 text-gray-400 hover:text-white"
          >
            <Gauge className="w-5 h-5" />
            <span className="text-[10px] font-medium">Readings</span>
          </Link>
        )}
      </nav>
      
    </div>
  );
}
