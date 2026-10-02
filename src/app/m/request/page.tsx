import React from "react";
import { prisma } from "@/lib/db";
import { loadCurrentUser } from "@/lib/auth";
import MobileRequestForm from "./MobileRequestForm";

export default async function MobileRequestPage() {
  const user = await loadCurrentUser();
  if (!user) return null;

  const assets = await prisma.asset.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      regNo: true,
      meterType: true,
    },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1">
        <h1 className="text-lg font-bold text-white tracking-tight">Raise Fuel Request</h1>
        <span className="text-xs text-slate-400 font-mono">
          {new Date().toLocaleDateString("en-GB")}
        </span>
      </div>

      <MobileRequestForm assets={assets} />
    </div>
  );
}
