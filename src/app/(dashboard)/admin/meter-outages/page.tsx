import React from "react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import MeterOutagesClient from "./MeterOutagesClient";

export const dynamic = "force-dynamic";

export default async function AdminMeterOutagesPage() {
  await requireAdmin();

  const [outages, assets] = await Promise.all([
    prisma.meterOutage.findMany({
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            regNo: true,
            meterType: true,
            typeLabel: true,
          },
        },
        openedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        closedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: [
        { endDate: "asc" }, // nulls first in SQLite
        { startDate: "desc" },
      ],
    }),
    prisma.asset.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        regNo: true,
        meterType: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  return <MeterOutagesClient initialOutages={outages} assets={assets} />;
}
