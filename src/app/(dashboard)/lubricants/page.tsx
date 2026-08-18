import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Droplets } from "lucide-react";
import LubricantManager from "./LubricantManager";

export default async function LubricantsPage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && session.role !== "WORKSHOP") redirect("/");

  const lubricants = await prisma.lubricant.findMany({
    orderBy: [{ active: "desc" }, { oilType: "asc" }, { name: "asc" }],
  });
  const priced = lubricants.filter((l) => l.pricePerUnitCents != null).length;

  const rows = lubricants.map((l) => ({
    id: l.id,
    name: l.name,
    oilType: l.oilType,
    unit: l.unit,
    pricePerUnitCents: l.pricePerUnitCents,
    note: l.note,
    active: l.active,
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-1">
        <Droplets className="w-6 h-6 text-cyan-400" />
        <h1 className="text-xl font-bold text-white">Lubricants</h1>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        Priced oils &amp; greases for service costing — {lubricants.length} products, {priced} priced.
        A service oil line costs qty × the unit price below.
      </p>
      <LubricantManager rows={rows} />
    </div>
  );
}
