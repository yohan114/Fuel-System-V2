import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOilLines, getFilterLines } from "@/lib/service/master";
import { getServiceRates } from "@/lib/service/charge";
import { ArrowLeft, ClipboardPlus } from "lucide-react";
import DetailedServiceForm from "../components/DetailedServiceForm";

interface PageProps {
  searchParams: Promise<{ asset?: string }>;
}

export default async function NewServicePage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;
  // Logging services is a "manage" action — admins only (matches the server action).
  if (session.role !== "ADMIN") redirect("/service");

  const sp = await props.searchParams;

  const [assetsRaw, oilLines, filterLines, rates] = await Promise.all([
    prisma.asset.findMany({
      where: { status: { not: "DISPOSED" } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, regNo: true, brand: true, model: true, meterType: true },
    }),
    getOilLines(),
    getFilterLines(),
    getServiceRates(),
  ]);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/5 pb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ClipboardPlus className="w-5 h-5 text-indigo-400" /> New Service Sheet
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            Record a full service — oils, filters and costs. The total is calculated automatically and the planner resets for this vehicle.
          </p>
        </div>
        <Link href="/service/records" className="text-xs font-semibold text-gray-400 hover:text-white flex items-center gap-1.5 whitespace-nowrap">
          <ArrowLeft className="w-4 h-4" /> Records
        </Link>
      </div>

      <DetailedServiceForm
        assets={assetsRaw}
        oilLines={oilLines}
        filterLines={filterLines}
        rates={rates}
        defaultAssetCode={sp.asset}
      />
    </div>
  );
}
