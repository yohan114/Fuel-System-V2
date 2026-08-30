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
  ClipboardList,
  Handshake,
  FileSpreadsheet,
  MapPin,
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
  const isSitePump = session.role === "SITE_PUMP";
 
  const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
  ];

  if (isAdmin) {
    navItems.push(
      { label: "Allocator Console", href: "/allocator", icon: Car },
      { label: "Workshop Console", href: "/workshop", icon: Database },
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Hire Fleet", href: "/hire", icon: Handshake },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Reports", href: "/fuel/report", icon: FileCheck },
      // Admins had no way into the reports console from the menu at all — every
      // other role has this entry — so the exports and the site-wise monthly
      // fuel sheet were reachable only by typing the URL.
      { label: "Reports Console", href: "/reports", icon: FileSpreadsheet },
      { label: "Fuel by Site", href: "/reports/site-fuel", icon: MapPin },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Fuel Integrity", href: "/integrity", icon: ShieldAlert },
      { label: "Tank Reconciliation", href: "/admin/tanks", icon: Droplets },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Services", href: "/service/log", icon: ClipboardList },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon },
      { label: "Lubricants", href: "/lubricants", icon: Droplets },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Fuel & Rental Rates", href: "/rates", icon: Gauge },
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
      { label: "Services", href: "/service/log", icon: ClipboardList },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Fuel & Rental Rates", href: "/rates", icon: Gauge },
      { label: "Alerts", href: "/alerts", icon: Bell }
    );
  } else if (isWorkshop) {
    navItems.push(
      { label: "Workshop Console", href: "/workshop", icon: Database },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Reports", href: "/fuel/report", icon: FileCheck },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Filter Database", href: "/filters", icon: FilterIcon }
    );
  } else if (isSitePump) {
    // SITE_PUMP: a site pump operator — issues fuel + requests from the site's
    // pump (Site Console), and sees only their own site's data.
    navItems.push(
      { label: "Site Console", href: "/site", icon: Database },
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Reports", href: "/fuel/report", icon: FileCheck },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Reports Console", href: "/reports", icon: FileCheck },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Services", href: "/service/log", icon: ClipboardList },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Alerts", href: "/alerts", icon: Bell }
    );
  } else {
    // USER role
    navItems.push(
      { label: "Fleet Directory", href: "/fleet", icon: Car },
      { label: "Fuel Requests", href: "/fuel/requests", icon: FileText },
      { label: "Fuel Issues", href: "/fuel/issues", icon: Fuel },
      { label: "Fuel Reports", href: "/fuel/report", icon: FileCheck },
      { label: "Fuel Corrections", href: "/fuel/corrections", icon: Wrench },
      { label: "Meter Readings", href: "/readings", icon: Gauge },
      { label: "Reports Console", href: "/reports", icon: FileCheck },
      { label: "Site Fuel", href: "/sites", icon: Building2 },
      { label: "Service Planner", href: "/service", icon: Wrench },
      { label: "Services", href: "/service/log", icon: ClipboardList },
      { label: "Breakdown Log", href: "/breakdowns", icon: AlertTriangle },
      { label: "Analytics", href: "/analytics", icon: Activity },
      { label: "Billing", href: "/billing", icon: Receipt },
      { label: "Receivables", href: "/billing/aging", icon: Wallet },
      { label: "Alerts", href: "/alerts", icon: Bell }
    );
  }

  return (
    // On desktop the shell is exactly one viewport tall and the two columns
    // scroll independently. It used to be min-h-screen, which let the whole
    // document grow with the content — so <main>'s overflow-y-auto never
    // actually engaged, and the sidebar stretched with the page until the user
    // card and Sign Out sat somewhere below the fold. Mobile keeps min-h-screen:
    // it is a single column with a fixed bottom nav, and locking its height
    // would break scrolling on short screens.
    <div className="min-h-screen md:h-screen md:overflow-hidden flex flex-col md:flex-row bg-[#090a0f] text-gray-200">

      {/* 1. Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 h-screen bg-[#121420] border-r border-white/5 p-6 flex-shrink-0">
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

        {/* Navigation Links.
            min-h-0 is load-bearing: a flex child defaults to min-height:auto,
            which refuses to shrink below its content, so overflow-y-auto here
            would never scroll and the list would push the footer off-screen
            instead. An admin has 28 entries — well past one viewport. */}
        <nav className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
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

        </nav>

        {/* Pinned footer: System Admin, then who you are, then Sign Out.
            Outside <nav> on purpose. Inside it, System Admin scrolled away with
            the other 28 entries and the whole block ended up below the fold;
            out here it is always at the bottom of the window, which is where
            people look for it. flex-shrink-0 stops the nav's overflow from
            squeezing it. */}
        <div className="flex-shrink-0 border-t border-white/5 pt-4 mt-4 flex flex-col gap-4">
          {isAdmin && (
            <Link
              href="/admin/prices"
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-all"
            >
              <Settings className="w-5 h-5" />
              System Admin
            </Link>
          )}
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
