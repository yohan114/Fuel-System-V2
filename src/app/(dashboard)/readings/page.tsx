import type { Prisma } from "@prisma/client";
import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import { assetSearchClause } from "@/lib/fleet/asset-search";
import ReadingsClient from "./ReadingsClient";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function ReadingsPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const searchParams = await props.searchParams;
  const q = searchParams.q || "";

  // 1. Build where query
  const where: Prisma.MeterReadingWhereInput = {};
  const assetSearch = assetSearchClause(q);
  if (assetSearch) where.asset = assetSearch;

  // Project-scoped users see readings only for vehicles currently assigned to their site
  const visible = await visibleAssetIdsForUser(session);
  if (visible) {
    where.assetId = { in: [...visible] };
  }

  // 2. Fetch readings, active outages, and visible assets in parallel
  const [readings, activeOutages, assets] = await Promise.all([
    prisma.meterReading.findMany({
      where,
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            regNo: true,
            meterType: true,
          },
        },
        recordedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        readingDate: "desc",
      },
      take: 200,
    }),
    prisma.meterOutage.findMany({
      where: {
        endDate: null,
        ...(visible ? { assetId: { in: [...visible] } } : {}),
      },
      include: {
        asset: {
          select: {
            id: true,
            code: true,
            regNo: true,
            meterType: true,
          },
        },
        openedBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        startDate: "asc",
      },
    }),
    prisma.asset.findMany({
      where: {
        status: "ACTIVE",
        ...(visible ? { id: { in: [...visible] } } : {}),
      },
      select: {
        id: true,
        code: true,
        regNo: true,
        meterType: true,
      },
      orderBy: {
        code: "asc",
      },
    }),
  ]);

  return (
    <ReadingsClient
      readings={readings}
      activeOutages={activeOutages}
      assets={assets}
      q={q}
    />
  );
}
