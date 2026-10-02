import { prisma } from "@/lib/db";
import { ok, err } from "@/lib/api/respond";

export async function GET() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;

    return ok({
      status: "healthy",
      database: "connected",
      latencyMs,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return err("SERVICE_UNAVAILABLE", "Database connection check failed", 503, {
      time: new Date().toISOString(),
    });
  }
}
