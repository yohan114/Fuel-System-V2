import React from "react";
import { prisma } from "@/lib/db";
import { loadCurrentUser } from "@/lib/auth";
import MobileIssueForm from "./MobileIssueForm";

export default async function MobileIssuePage() {
  const user = await loadCurrentUser();
  if (!user) return null;

  const [assets, tanks] = await Promise.all([
    prisma.asset.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        regNo: true,
        meterType: true,
        dailyCapLitres: true,
      },
      orderBy: { code: "asc" },
    }),
    prisma.bulkTank.findMany({
      select: {
        id: true,
        name: true,
        fuelKind: true,
        balance: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1">
        <h1 className="text-lg font-bold text-white tracking-tight">Dispense Fuel</h1>
        <span className="text-xs text-slate-400 font-mono">
          {new Date().toLocaleDateString("en-GB")}
        </span>
      </div>

      <MobileIssueForm
        assets={assets}
        tanks={tanks}
        defaultTankId={user.bulkTankId || tanks[0]?.id || ""}
      />
    </div>
  );
}
