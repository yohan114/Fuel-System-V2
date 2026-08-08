// Pure timing helpers for the daily price scheduler — no I/O, unit-tested.

// Sri Lanka is UTC+5:30 year-round (no DST) — shift the instant and read it as
// wall-clock in UTC.
export function colomboParts(now: Date): { day: string; hour: number } {
  const c = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return { day: c.toISOString().slice(0, 10), hour: c.getUTCHours() };
}

// scraper.cron is a standard "m h * * *" string; we run daily and only use the
// hour field (day/month are ignored — the point is a daily refresh).
export function parseRunHour(cron: string | null | undefined, fallback = 6): number {
  if (!cron) return fallback;
  const parts = cron.trim().split(/\s+/);
  if (parts.length >= 2) {
    const h = parseInt(parts[1], 10);
    if (!Number.isNaN(h) && h >= 0 && h <= 23) return h;
  }
  return fallback;
}

export function shouldSyncNow(o: {
  enabled: boolean;
  lastSyncDay: string | null;
  colomboDay: string;
  colomboHour: number;
  runHour: number;
}): boolean {
  if (!o.enabled) return false;
  if (o.colomboHour < o.runHour) return false; // not yet the scheduled hour today
  return o.lastSyncDay !== o.colomboDay; // haven't run yet today
}
