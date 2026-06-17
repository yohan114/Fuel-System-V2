import React from "react";
import { prisma } from "@/lib/db";
import { resolvePeriod } from "@/lib/billing/period";
import AssignmentsConsole from "./AssignmentsConsole";

export default async function AssignmentsPage() {
  const now = new Date();
  const period = resolvePeriod(now.getFullYear(), now.getMonth() + 1);

  const [projects, assets, assignments] = await Promise.all([
    prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.asset.findMany({
      where: { status: { not: "DISPOSED" } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, brand: true, typeLabel: true, regNo: true, meterType: true },
    }),
    // Current + this-month assignments: anything still open, or ending on/after
    // the start of the current month.
    prisma.assetAssignment.findMany({
      where: { OR: [{ endDate: null }, { endDate: { gte: period.start } }] },
      orderBy: [{ startDate: "desc" }],
      include: {
        asset: { select: { code: true, brand: true, typeLabel: true } },
        project: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  const serialized = assignments.map((a) => ({
    id: a.id,
    startDate: a.startDate.toISOString(),
    endDate: a.endDate ? a.endDate.toISOString() : null,
    note: a.note,
    asset: { code: a.asset.code, brand: a.asset.brand, typeLabel: a.asset.typeLabel },
    project: { id: a.project.id, code: a.project.code, name: a.project.name },
  }));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-white tracking-wide">Vehicle Assignments</h2>
        <p className="text-xs text-gray-400 mt-1">
          Post vehicles to sites for a date range. A vehicle can move between sites within a month —
          billing then splits the month across each site it worked. Site logins only see and log
          the vehicles assigned to them.
        </p>
      </div>
      <AssignmentsConsole projects={projects} assets={assets} initialAssignments={serialized} />
    </div>
  );
}
