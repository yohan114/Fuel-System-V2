import { prisma } from "../db";

// Overlapping site postings. Two assignments for the same vehicle whose date
// windows intersect make getMonthSegments double-count days, inflating the
// multi-site bill. This finds each overlapping pair and suggests trimming the
// earlier posting to end the day before the later one starts.

export interface OverlapAssignment {
  id: string;
  projectCode: string;
  projectName: string;
  start: string; // YYYY-MM-DD
  end: string | null;
}

export interface AssignmentOverlap {
  assetId: string;
  assetCode: string;
  earlier: OverlapAssignment;
  later: OverlapAssignment;
  suggestedEnd: string | null; // trim the earlier posting to this day; null when they start the same day (delete one instead)
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function getAssignmentOverlaps(): Promise<AssignmentOverlap[]> {
  const rows = await prisma.assetAssignment.findMany({
    where: { asset: { status: { not: "DISPOSED" } } },
    orderBy: [{ assetId: "asc" }, { startDate: "asc" }],
    select: {
      id: true,
      startDate: true,
      endDate: true,
      assetId: true,
      asset: { select: { code: true } },
      project: { select: { code: true, name: true } },
    },
  });

  const view = (r: (typeof rows)[number]): OverlapAssignment => ({
    id: r.id,
    projectCode: r.project.code,
    projectName: r.project.name,
    start: ymd(r.startDate),
    end: r.endDate ? ymd(r.endDate) : null,
  });

  const overlaps: AssignmentOverlap[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (prev.assetId !== cur.assetId) continue;
    const prevEnd = prev.endDate ? prev.endDate.getTime() : Infinity;
    if (cur.startDate.getTime() <= prevEnd) {
      const dayBefore = new Date(cur.startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const suggestedEnd = dayBefore.getTime() >= prev.startDate.getTime() ? ymd(dayBefore) : null;
      overlaps.push({
        assetId: cur.assetId,
        assetCode: cur.asset.code,
        earlier: view(prev),
        later: view(cur),
        suggestedEnd,
      });
    }
  }
  return overlaps;
}
