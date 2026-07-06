import { dayNumber } from "../assignments";

// Attribute a fuel issue to the site the vehicle was *assigned* to on the day
// of the issue — not the pump/source it was physically drawn from. A vehicle
// posted to Wadakada that fuels at Badalgama still belongs to Wadakada's fuel.
//
// Pure and index-built so thousands of issues resolve in memory against the
// full assignment list without a query per issue.

export interface AssignmentSpan {
  assetId: string;
  projectId: string;
  startDate: Date;
  endDate: Date | null; // null = still open
}

export interface SiteSpan {
  projectId: string;
  startDay: number;
  endDay: number | null; // inclusive; null = open-ended
}

// Group assignments by asset, each list sorted by start day descending so the
// first covering span found is the most recent posting.
export function indexAssignments(assignments: AssignmentSpan[]): Map<string, SiteSpan[]> {
  const byAsset = new Map<string, SiteSpan[]>();
  for (const a of assignments) {
    const span: SiteSpan = {
      projectId: a.projectId,
      startDay: dayNumber(a.startDate),
      endDay: a.endDate ? dayNumber(a.endDate) : null,
    };
    const list = byAsset.get(a.assetId) ?? [];
    list.push(span);
    byAsset.set(a.assetId, list);
  }
  for (const list of byAsset.values()) list.sort((x, y) => y.startDay - x.startDay);
  return byAsset;
}

// The projectId the asset was assigned to on `date`, or null when no assignment
// covers it (caller falls back to the asset's current project pointer).
export function assignedSiteOn(
  index: Map<string, SiteSpan[]>,
  assetId: string,
  date: Date,
): string | null {
  const spans = index.get(assetId);
  if (!spans) return null;
  const day = dayNumber(date);
  for (const s of spans) {
    if (s.startDay <= day && (s.endDay == null || s.endDay >= day)) return s.projectId;
  }
  return null;
}
