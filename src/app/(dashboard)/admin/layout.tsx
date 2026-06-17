import React from "react";
import { requireAdmin } from "@/lib/auth";
import Link from "next/link";
import { Coins, Database, Users2, ShieldAlert, FolderGit2, Receipt, CalendarRange } from "lucide-react";

interface AdminLayoutProps {
  children: React.ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  // Enforce ADMIN role check immediately at the layout level
  try {
    await requireAdmin();
  } catch (err) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 bg-red-500/10 border border-red-500/10 text-red-400 rounded-full flex items-center justify-center mb-4">
          <ShieldAlert className="w-6 h-6 animate-pulse" />
        </div>
        <h2 className="text-lg font-bold text-white tracking-wide">Access Forbidden</h2>
        <p className="text-xs text-gray-500 mt-2 max-w-sm">
          You do not have administrative permissions to view this system console. All activities are audited.
        </p>
      </div>
    );
  }

  const subLinks = [
    { label: "Fuel Prices", href: "/admin/prices", icon: Coins },
    { label: "Project Sites", href: "/admin/projects", icon: FolderGit2 },
    { label: "Vehicle Assignments", href: "/admin/assignments", icon: CalendarRange },
    { label: "Database Backups", href: "/admin/backups", icon: Database },
    { label: "User Accounts", href: "/admin/users", icon: Users2 },
    { label: "Billing Settings", href: "/admin/billing", icon: Receipt },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide">System Admin Console</h1>
        <p className="text-xs text-gray-400 mt-1">
          Perform administrative configurations, run hot database backups, manage users, and manually override fuel prices.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Side Navigation Menu */}
        <nav className="w-full lg:w-56 bg-[#121420] border border-white/5 p-4 rounded-2xl flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible">
          {subLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition-all whitespace-nowrap lg:whitespace-normal"
              >
                <Icon className="w-4 h-4 text-gray-500" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Side Console Area */}
        <div className="flex-1 w-full bg-[#121420] border border-white/5 p-6 md:p-8 rounded-2xl shadow-xl">
          {children}
        </div>
      </div>
    </div>
  );
}
