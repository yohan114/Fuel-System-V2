import { prisma } from "@/lib/db";
import { syncWorkshopServices, DEFAULT_WORKSHOP_DB } from "./workshop-sync";
import { errorMessage } from "@/lib/errors";

// Keeps the fuel system's service history in step with WorkshopOne
// (http://localhost:1929) without anyone pressing anything. The app is a
// long-running server, so an in-process timer is a reliable "automatic update"
// and needs no external cron and no change to WorkshopOne.
//
// Five minutes is frequent enough that a service booked in the workshop shows
// up here while the fitter is still in the yard, and light enough that it costs
// nothing: a sync with no changes is a handful of indexed reads.
//
// Settings that control it, all optional:
//   serviceSync.enabled   "false" to switch it off        (default on)
//   serviceSync.dbPath    where WorkshopOne's database is (default D:/Master system 1/data/workshopone.db)
//   serviceSync.lastRun   written after every attempt, for the admin screen
//   serviceSync.lastResult a JSON summary of the last run

const INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 20_000; // never block server startup
let started = false;
let running = false;

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function runWorkshopSync(): Promise<void> {
  // A slow sync must never overlap itself — two passes would fight over the
  // same sourceRefs.
  if (running) return;
  running = true;
  try {
    const [enabledS, dbPath] = await Promise.all([
      getSetting("serviceSync.enabled"),
      getSetting("serviceSync.dbPath"),
    ]);
    if (enabledS === "false") return;

    const res = await syncWorkshopServices({ dbPath: dbPath || undefined });
    await setSetting("serviceSync.lastRun", new Date().toISOString());
    await setSetting("serviceSync.lastResult", JSON.stringify(res));

    if (!res.ok) {
      console.error(`[workshop-sync] failed: ${res.error}`);
      return;
    }
    // Only worth a line in the log when something actually moved.
    if (res.created || res.updated || res.metersAdded || res.migratedFromArchive) {
      console.log(
        `[workshop-sync] ${res.created} new, ${res.updated} updated, ${res.metersAdded} meter readings` +
          (res.migratedFromArchive ? `, ${res.migratedFromArchive} re-keyed from the archive import` : "") +
          ` (scanned ${res.scanned})`
      );
      // A new service moves a machine's service anchor, so the planner and the
      // machine page have to be re-rendered.
      const { revalidatePath } = await import("next/cache");
      revalidatePath("/service");
      revalidatePath("/service/log");
    }
  } catch (err: unknown) {
    console.error("[workshop-sync] error, will retry:", errorMessage(err));
  } finally {
    running = false;
  }
}

export function startWorkshopSyncScheduler(): void {
  if (started) return;
  started = true;
  const t = setTimeout(() => {
    void runWorkshopSync();
    const iv = setInterval(() => void runWorkshopSync(), INTERVAL_MS);
    iv.unref?.();
  }, FIRST_RUN_DELAY_MS);
  t.unref?.();
  console.log(`[workshop-sync] started — polling WorkshopOne every ${INTERVAL_MS / 60000} min (${DEFAULT_WORKSHOP_DB})`);
}
