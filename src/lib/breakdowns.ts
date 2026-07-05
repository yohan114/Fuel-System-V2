import { prisma } from "./db";

// Breakdown "episodes" derived from the daily condition log. A run of
// consecutive calendar days flagged BREAKDOWN is one episode; a WORKING day or
// a gap in logging ends it (the machine is assumed repaired). An episode is
// "open" when it ends at the asset's most recent condition log — nothing has
// been logged after it, so the machine is still down as far as the log knows.

export interface ConditionDayRow {
  day: string; // YYYY-MM-DD calendar day key
  status: string; // "WORKING" | "BREAKDOWN"
  note: string | null;
}

export interface EpisodeSpan {
  startDay: string;
  endDay: string; // last BREAKDOWN day of the run (inclusive)
  days: number; // run length in days
  open: boolean;
  lastNote: string | null; // most recent non-empty note in the run
}

export interface BreakdownEpisode extends EpisodeSpan {
  assetId: string;
  code: string;
  meterType: string;
  categoryName: string | null;
  projectId: string | null;
  projectName: string | null;
  lastLoggedDay: string; // the asset's most recent condition log overall
}

export interface BreakdownLog {
  episodes: BreakdownEpisode[]; // overlapping the window, newest first
  openNow: BreakdownEpisode[]; // still-open episodes, longest down first
  stats: {
    assetsDownNow: number;
    downtimeDaysInWindow: number; // BREAKDOWN days logged inside [from, to]
    closedCount: number; // closed episodes overlapping the window
    avgRepairDays: number | null; // mean length of those closed episodes
  };
}

function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) + 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// logDate rows are written as server-local midnight of the intended calendar
// day (see actions/condition.ts), so local getters reconstruct that day.
function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Pure: rows for ONE asset, sorted ascending by day, one row per day.
export function coalesceEpisodes(rows: ConditionDayRow[]): EpisodeSpan[] {
  const episodes: EpisodeSpan[] = [];
  let run: { startDay: string; endDay: string; days: number; lastNote: string | null } | null = null;

  const flush = () => {
    if (run) {
      episodes.push({ ...run, open: false });
      run = null;
    }
  };

  for (const row of rows) {
    if (row.status !== "BREAKDOWN") {
      flush();
      continue;
    }
    if (run && nextDay(run.endDay) === row.day) {
      run.endDay = row.day;
      run.days += 1;
      if (row.note) run.lastNote = row.note;
    } else {
      flush(); // either no run, or a logging gap — the old run is over
      run = { startDay: row.day, endDay: row.day, days: 1, lastNote: row.note || null };
    }
  }
  flush();

  // Open = the last row overall is BREAKDOWN and belongs to the final run.
  const last = rows[rows.length - 1];
  const tail = episodes[episodes.length - 1];
  if (last && tail && last.status === "BREAKDOWN" && tail.endDay === last.day) {
    tail.open = true;
  }
  return episodes;
}

const LOOKBACK_DAYS = 120;

export async function getBreakdownEpisodes(opts: {
  from: Date;
  to: Date;
  projectId?: string;
  assetId?: string;
  now?: Date;
}): Promise<BreakdownLog> {
  const now = opts.now ?? new Date();
  const fetchStart = new Date(opts.from.getTime() - LOOKBACK_DAYS * 86400000);
  const fetchEnd = now > opts.to ? now : opts.to;
  const fromDay = dayOf(opts.from);
  const toDay = dayOf(opts.to);

  const conditions = await prisma.dailyCondition.findMany({
    where: {
      logDate: { gte: fetchStart, lte: fetchEnd },
      ...(opts.assetId ? { assetId: opts.assetId } : {}),
      ...(opts.projectId ? { asset: { projectId: opts.projectId } } : {}),
    },
    select: {
      status: true,
      note: true,
      logDate: true,
      asset: {
        select: {
          id: true,
          code: true,
          meterType: true,
          category: { select: { name: true } },
          project: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { logDate: "asc" },
  });

  interface AssetAcc {
    asset: (typeof conditions)[number]["asset"];
    rows: ConditionDayRow[];
  }
  const byAsset = new Map<string, AssetAcc>();
  for (const c of conditions) {
    const acc = byAsset.get(c.asset.id) ?? { asset: c.asset, rows: [] };
    acc.rows.push({ day: dayOf(c.logDate), status: c.status, note: c.note });
    byAsset.set(c.asset.id, acc);
  }

  const episodes: BreakdownEpisode[] = [];
  const openNow: BreakdownEpisode[] = [];
  let downtimeDaysInWindow = 0;

  for (const { asset, rows } of byAsset.values()) {
    for (const r of rows) {
      if (r.status === "BREAKDOWN" && r.day >= fromDay && r.day <= toDay) downtimeDaysInWindow++;
    }
    const spans = coalesceEpisodes(rows);
    if (spans.length === 0) continue;
    const lastLoggedDay = rows[rows.length - 1].day;
    for (const span of spans) {
      const ep: BreakdownEpisode = {
        ...span,
        assetId: asset.id,
        code: asset.code,
        meterType: asset.meterType,
        categoryName: asset.category?.name ?? null,
        projectId: asset.project?.id ?? null,
        projectName: asset.project?.name ?? null,
        lastLoggedDay,
      };
      const overlapsWindow = span.startDay <= toDay && span.endDay >= fromDay;
      if (overlapsWindow) episodes.push(ep);
      if (span.open) openNow.push(ep);
    }
  }

  episodes.sort((a, b) => b.endDay.localeCompare(a.endDay) || b.days - a.days);
  openNow.sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));

  const closed = episodes.filter((e) => !e.open);
  const avgRepairDays = closed.length > 0 ? closed.reduce((s, e) => s + e.days, 0) / closed.length : null;

  return {
    episodes,
    openNow,
    stats: {
      assetsDownNow: openNow.length,
      downtimeDaysInWindow,
      closedCount: closed.length,
      avgRepairDays,
    },
  };
}
