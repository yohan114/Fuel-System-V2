import React from "react";
import { prisma } from "@/lib/db";
import { loadCurrentUser } from "@/lib/auth";
import MobileConditionList from "./MobileConditionList";
import { colomboDayKey } from "@/lib/colombo-date";

export default async function MobileConditionPage() {
  const user = await loadCurrentUser();
  if (!user) return null;

  const todayKey = colomboDayKey(new Date());
  const [colomboYear, colomboMonth, colomboDay] = todayKey.split("-").map(Number);
  const logDate = new Date(colomboYear, colomboMonth - 1, colomboDay);

  // Fetch active assets (optionally scoped to user's project if site user)
  const assets = await prisma.asset.findMany({
    where: {
      status: { in: ["ACTIVE", "INACTIVE"] },
      ...(user.projectId ? { projectId: user.projectId } : {}),
    },
    select: {
      id: true,
      code: true,
      regNo: true,
      status: true,
      dailyConditions: {
        where: { logDate },
        take: 1,
        select: {
          id: true,
          status: true,
          note: true,
        },
      },
    },
    orderBy: { code: "asc" },
  });

  const formattedAssets = assets.map((a) => ({
    id: a.id,
    code: a.code,
    regNo: a.regNo,
    assetStatus: a.status,
    todayStatus: a.dailyConditions[0]?.status ?? null,
    todayNote: a.dailyConditions[0]?.note ?? null,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-1">
        <h1 className="text-lg font-bold text-white tracking-tight">Fleet Condition</h1>
        <span className="text-xs text-slate-400 font-mono">
          {todayKey}
        </span>
      </div>

      <MobileConditionList assets={formattedAssets} />
    </div>
  );
}
