import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public health probe for the E&C Master Portal. No auth (the proxy lets
// /api/health pass). Returns 200 when the DB is reachable, 503 otherwise.
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      system: "fuel",
      version: "0.1.0",
      time: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, system: "fuel", time: new Date().toISOString() },
      { status: 503 }
    );
  }
}
