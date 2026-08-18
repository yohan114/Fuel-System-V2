// Runs once when a Next.js server instance starts (Node runtime only). We use it
// to kick off the in-app daily Ceypetco fuel-price scheduler so prices refresh
// without an external cron.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPriceScheduler } = await import("@/lib/prices/scheduler");
    startPriceScheduler();

    // Keeps the service history in step with WorkshopOne on :1929, so a service
    // booked in the workshop reaches the planner here on its own.
    const { startWorkshopSyncScheduler } = await import("@/lib/service/workshop-scheduler");
    startWorkshopSyncScheduler();
  }
}
