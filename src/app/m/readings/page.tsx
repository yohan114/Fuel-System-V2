import React from "react";
import { prisma } from "@/lib/db";
import { loadCurrentUser } from "@/lib/auth";
import MobileReadingsForm from "./MobileReadingsForm";

export default async function MobileReadingsPage() {
  const user = await loadCurrentUser();
  if (!user) return null;

  const assets = await prisma.asset.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      regNo: true,
      meterType: true,
      meterReadings: {
        orderBy: { readingDate: "desc" },
        take: 1,
        select: { value: true, readingDate: true },
      },
    },
    orderBy: { code: "asc" },
  });

  const formattedAssets = assets.map((a) => ({
    id: a.id,
    code: a.code,
    regNo: a.regNo,
    meterType: a.meterType,
    lastReading: a.meterReadings[0]?.value ?? null,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1">
        <h1 className="text-lg font-bold text-white tracking-tight">Log Meter Reading</h1>
        <span className="text-xs text-slate-400 font-mono">
          {new Date().toLocaleDateString("en-GB")}
        </span>
      </div>

      <MobileReadingsForm assets={formattedAssets} />
    </div>
  );
}
