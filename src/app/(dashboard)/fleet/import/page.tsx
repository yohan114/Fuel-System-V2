import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Truck, UploadCloud } from "lucide-react";
import { FleetImportForm } from "./FleetImportForm";

export default async function FleetImportPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/fleet");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/fleet" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Fleet Directory
            </Link>
            <span>/</span>
            <span className="text-white font-medium">Bulk Import</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-indigo-400" /> Bulk Import Vehicles & Machinery
          </h1>
          <p className="text-xs text-gray-400">
            Import new assets or batch-update existing machinery attributes from CSV files or spreadsheets.
          </p>
        </div>
      </div>

      <FleetImportForm />
    </div>
  );
}
