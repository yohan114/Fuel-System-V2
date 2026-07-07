import React from "react";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Handshake } from "lucide-react";
import HireManager from "./HireManager";

export const dynamic = "force-dynamic";

// Monthly-equivalent of a hire rate, for a rough portfolio total.
function monthlyEquivCents(rateCents: number | null, basis: string | null): number {
  if (!rateCents) return 0;
  if (basis === "month") return rateCents;
  if (basis === "day") return rateCents * 26;      // ~working days / month
  if (basis === "hour") return rateCents * 8 * 26; // 8 h/day
  return 0;
}

export default async function HirePage() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN") redirect("/");

  const [hired, categories, ownedRaw] = await Promise.all([
    prisma.asset.findMany({
      where: { ownership: "HIRED", status: { not: "DISPOSED" } },
      include: { category: true, project: true },
      orderBy: [{ hireEnd: "asc" }, { code: "asc" }],
    }),
    prisma.category.findMany({ orderBy: { code: "asc" } }),
    prisma.asset.findMany({
      where: { ownership: "OWNED", status: "ACTIVE" },
      select: { id: true, code: true, category: { select: { code: true } } },
      orderBy: { code: "asc" },
    }),
  ]);

  const now = Date.now();
  const onHireNow = hired.filter((a) => !a.hireEnd || a.hireEnd.getTime() >= now).length;
  const monthlyTotal = hired.reduce((s, a) => s + monthlyEquivCents(a.hireRateCents, a.hireRateBasis), 0);

  const hiredRows = hired.map((a) => ({
    id: a.id,
    code: a.code,
    categoryCode: a.category.code,
    categoryName: a.category.name,
    meterType: a.meterType,
    supplier: a.hireSupplier,
    rateCents: a.hireRateCents,
    basis: a.hireRateBasis,
    start: a.hireStart ? a.hireStart.toISOString().slice(0, 10) : null,
    end: a.hireEnd ? a.hireEnd.toISOString().slice(0, 10) : null,
    note: a.hireNote,
    site: a.project?.name ?? null,
    minBillHours: a.minBillHours,
  }));

  const categoryOpts = categories.map((c) => ({ id: c.id, code: c.code, name: c.name, defaultMeterType: c.defaultMeterType }));
  const ownedOpts = ownedRaw.map((a) => ({ id: a.id, code: a.code, categoryCode: a.category.code }));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-1">
        <Handshake className="w-6 h-6 text-amber-400" />
        <h1 className="text-xl font-bold text-white">Hire Fleet</h1>
      </div>
      <p className="text-xs text-gray-500 mb-6 max-w-3xl">
        Machines E&amp;C rents{" "}<strong className="text-gray-400">in</strong>{" "}from third-party owners. These fields track what
        E&amp;C pays the supplier — kept separate from the rental rate the company charges sites for the same machine.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-7">
        <div className="bg-white/5 border border-white/5 rounded-2xl px-5 py-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Hired machines</div>
          <div className="text-2xl font-bold text-white tabular-nums">{hired.length}</div>
        </div>
        <div className="bg-white/5 border border-white/5 rounded-2xl px-5 py-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">On hire now</div>
          <div className="text-2xl font-bold text-emerald-400 tabular-nums">{onHireNow}</div>
        </div>
        <div className="bg-white/5 border border-white/5 rounded-2xl px-5 py-4 col-span-2 md:col-span-1">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Est. hire cost / month</div>
          <div className="text-2xl font-bold text-amber-400 tabular-nums">
            {monthlyTotal > 0 ? `Rs ${(monthlyTotal / 100).toLocaleString("en-LK", { maximumFractionDigits: 0 })}` : "—"}
          </div>
        </div>
      </div>

      <HireManager hired={hiredRows} categories={categoryOpts} ownedAssets={ownedOpts} />
    </div>
  );
}
