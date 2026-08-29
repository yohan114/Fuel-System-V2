// The Fuel & Rental Rates table's own filter, in one place.
//
// The screen filters client-side and the export filters server-side, from two
// different processes. If each kept its own copy of the predicate they would
// drift the first time a filter was added, and the export would quietly stop
// matching the rows the person was looking at when they clicked it — the one
// thing an "export this table" button must never do.

import type { RateBandRow } from "./rates-overview";

export type RateFilter = "all" | "over" | "measured" | "no-band" | "conflict" | "no-card";

export const RATE_FILTERS: { key: RateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "over", label: "Over standard" },
  { key: "measured", label: "Measured" },
  { key: "no-band", label: "No band" },
  { key: "conflict", label: "Not comparable" },
  { key: "no-card", label: "No rate card" },
];

const KEYS = new Set(RATE_FILTERS.map((f) => f.key));

/** A filter key from a URL, or "all" for anything unrecognised. */
export function asRateFilter(v: string | null | undefined): RateFilter {
  return v && KEYS.has(v as RateFilter) ? (v as RateFilter) : "all";
}

export interface RateTableQuery {
  q?: string;
  filter?: RateFilter;
}

/** What the search box looks at: the four fields shown or searchable on screen. */
function matchesTerm(r: RateBandRow, term: string): boolean {
  return (
    r.code.toLowerCase().includes(term) ||
    (r.regNo ?? "").toLowerCase().includes(term) ||
    (r.categoryName ?? "").toLowerCase().includes(term) ||
    (r.projectName ?? "").toLowerCase().includes(term)
  );
}

export function filterRateRows(rows: RateBandRow[], query: RateTableQuery): RateBandRow[] {
  const filter = query.filter ?? "all";
  const term = (query.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === "over" && r.state !== "OVER" && r.state !== "HEAVY") return false;
    if (filter === "measured" && r.intervals === 0) return false;
    if (filter === "no-band" && r.bandReason !== "no-band") return false;
    if (filter === "conflict" && r.bandReason !== "basis-conflict") return false;
    if (filter === "no-card" && r.bandReason !== "no-rate-card") return false;
    if (!term) return true;
    return matchesTerm(r, term);
  });
}

/**
 * How the sheet describes the rows it contains.
 *
 * The search term is echoed back, and it arrives from a query string, so it is
 * truncated before it reaches a cell. Node refuses a URL long enough to breach
 * Excel's 32,767-character cell limit, so this is not what stands between the
 * file and a corrupt workbook — it is here so the guarantee belongs to this
 * function rather than to a web server's header limit, and because a header
 * line thousands of characters long is unreadable either way.
 */
const MAX_TERM_IN_NOTE = 120;

export function describeRateQuery(query: RateTableQuery, shown: number, total: number): string {
  const filter = query.filter ?? "all";
  const label = RATE_FILTERS.find((f) => f.key === filter)?.label ?? "All";
  const raw = (query.q ?? "").trim();
  // Cut on code points, not UTF-16 units. String.slice would split a surrogate
  // pair mid-character and leave a lone surrogate in the cell, which is not
  // valid XML content.
  const points = Array.from(raw);
  const term = points.length > MAX_TERM_IN_NOTE ? `${points.slice(0, MAX_TERM_IN_NOTE).join("")}…` : raw;
  const bits: string[] = [];
  if (filter !== "all") bits.push(`filter “${label}”`);
  if (term) bits.push(`search “${term}”`);
  return bits.length
    ? `${shown} of ${total} machines — ${bits.join(", ")}`
    : `All ${total} machines`;
}
