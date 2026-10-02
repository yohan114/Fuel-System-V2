import React from "react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ArrowLeft, Wrench, CalendarClock, ListChecks, Settings2 } from "lucide-react";
import { PMMasterClient } from "./PMMasterClient";

interface PageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function PMMasterPage(props: PageProps) {
  const session = await getSession();
  if (!session) return null;

  const isAdmin = session.role === "ADMIN" || session.role === "WORKSHOP";
  const searchParams = await props.searchParams;

  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: { pmTasks: true, assets: true },
      },
    },
  });

  const selectedCategoryId = searchParams.category || categories[0]?.id || "";

  const tasks = selectedCategoryId
    ? await prisma.pMTask.findMany({
        where: { categoryId: selectedCategoryId },
        orderBy: [{ intervalHours: "asc" }, { sortOrder: "asc" }],
      })
    : [];

  const selectedCat = categories.find((c) => c.id === selectedCategoryId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Link href="/service" className="hover:text-white flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Service Planner
            </Link>
            <span>/</span>
            <span className="text-white font-medium">PM Master Catalogue</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-indigo-400" /> Preventive Maintenance (PM) Master Plan
          </h1>
          <p className="text-xs text-gray-400">
            Define standard service task ladders (10h, 50h, 250h, 500h, 1000h, 2000h) per machinery & vehicle category.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/service/calendar"
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold border border-white/5 transition-all flex items-center gap-1.5"
          >
            <CalendarClock className="w-4 h-4 text-amber-400" /> Service Calendar
          </Link>
        </div>
      </div>

      <PMMasterClient
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        tasks={tasks}
        isAdmin={isAdmin}
      />
    </div>
  );
}
