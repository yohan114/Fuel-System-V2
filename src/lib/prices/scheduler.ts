import { prisma } from "@/lib/db";
import { syncCeypetcoPrices } from "@/lib/prices/sync";
import { colomboParts, parseRunHour, shouldSyncNow } from "@/lib/prices/schedule-timing";

// In-app daily scheduler for the Ceypetco price sync. The app is a long-running
// server (`next start`), so a timer started from instrumentation.ts is a
// reliable "daily update" without an external cron. It respects the existing
// `scraper.enabled` / `scraper.cron` settings and records `scraper.lastSync`
// so a mid-day restart never double-runs.

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // re-check every 30 min
let started = false;

// --- runtime ---

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function tick(): Promise<void> {
  try {
    const [enabledS, cronS, lastSyncDay] = await Promise.all([
      getSetting("scraper.enabled"),
      getSetting("scraper.cron"),
      getSetting("scraper.lastSync"),
    ]);
    const enabled = enabledS == null ? true : enabledS === "true"; // default on
    const runHour = parseRunHour(cronS);
    const { day, hour } = colomboParts(new Date());

    if (!shouldSyncNow({ enabled, lastSyncDay, colomboDay: day, colomboHour: hour, runHour })) return;

    const res = await syncCeypetcoPrices();
    await setSetting("scraper.lastSync", day); // only on success, so failures retry next tick
    console.log(`[price-scheduler] ${day}: stored ${res.stored.length}, skipped ${res.skippedExisting.length} (effective ${res.effectiveFrom})`);
  } catch (err: any) {
    console.error("[price-scheduler] sync failed, will retry:", err?.message ?? err);
  }
}

export function startPriceScheduler(): void {
  if (started) return;
  started = true;
  // Delay the first check so it never blocks server startup, then poll.
  const t = setTimeout(() => {
    void tick();
    const iv = setInterval(() => void tick(), CHECK_INTERVAL_MS);
    iv.unref?.();
  }, 15_000);
  t.unref?.();
  console.log("[price-scheduler] started — daily Ceypetco price sync");
}
