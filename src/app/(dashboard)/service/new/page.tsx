import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { getServiceConfig } from "@/lib/service/config";
import ServiceSheetForm from "./ServiceSheetForm";

interface PageProps {
  searchParams: Promise<{ asset?: string }>;
}

export default async function NewServicePage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "WORKSHOP") redirect("/");

  const { asset: presetCode } = await props.searchParams;

  const [assets, lubricants, pricedFilters, cfg] = await Promise.all([
    prisma.asset.findMany({
      where: { status: "ACTIVE" },
      select: { code: true, regNo: true, model: true, brand: true, meterType: true },
      orderBy: { code: "asc" },
    }),
    prisma.lubricant.findMany({
      where: { active: true },
      select: { name: true, oilType: true, unit: true, pricePerUnitCents: true },
      orderBy: [{ oilType: "asc" }, { name: "asc" }],
    }),
    prisma.filter.findMany({
      where: { priceCents: { not: null } },
      select: { hifiPartNo: true, oemPartNo: true, priceCents: true },
      take: 2000,
    }),
  ]).then(async ([a, l, f]) => [a, l, f, await getServiceConfig()] as const);

  const assetOpts = assets.map((a) => ({ code: a.code, regNo: a.regNo, model: a.model || a.brand || null, meterType: a.meterType }));
  const filterOpts = pricedFilters
    .map((f) => ({ partNo: (f.hifiPartNo || f.oemPartNo || "").trim(), priceCents: f.priceCents }))
    .filter((f) => f.partNo);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <Link href="/service" className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 mb-3"><ArrowLeft className="w-3.5 h-3.5" /> Service Planner</Link>
      <div className="flex items-center gap-3 mb-1">
        <ClipboardList className="w-6 h-6 text-cyan-400" />
        <h1 className="text-xl font-bold text-white">New Service Sheet</h1>
      </div>
      <p className="text-xs text-gray-500 mb-6">Vehicle / Machinery Service Details — lines cost automatically from the lubricant &amp; filter prices; labour and sundry are added on parts.</p>
      <ServiceSheetForm
        assets={assetOpts}
        lubricants={lubricants}
        filters={filterOpts}
        labourPct={cfg.labourPct}
        sundryPct={cfg.sundryPct}
        presetCode={presetCode}
      />
    </div>
  );
}
