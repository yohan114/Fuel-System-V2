// Runs once when a Next.js server instance starts (Node runtime only). We use it
// to kick off the in-app daily Ceypetco fuel-price scheduler so prices refresh
// without an external cron.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPriceScheduler } = await import("@/lib/prices/scheduler");
    startPriceScheduler();
  }
}
