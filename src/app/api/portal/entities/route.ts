import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Read-only entity list for the Master Portal's master-data spine (M4):
// this system's machines (keyed by E&C code) and sites/projects.
// Token-authed via x-portal-token; the proxy already lets /api/portal/* pass.
export async function GET(request: NextRequest) {
  const token = request.headers.get("x-portal-token");
  const expected = process.env.FUEL_PORTAL_TOKEN || process.env.PORTAL_TOKEN;
  if (!expected || !token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [assets, projects] = await Promise.all([
    prisma.asset.findMany({
      select: { id: true, code: true, brand: true, typeLabel: true, regNo: true, serialNo: true, status: true },
      orderBy: { code: "asc" },
    }),
    prisma.project.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
  ]);

  return NextResponse.json({
    system: "fuel",
    generatedAt: new Date().toISOString(),
    machines: assets.map((a) => ({
      localId: a.id,
      code: a.code,
      label: [a.brand, a.typeLabel].filter(Boolean).join(" ") || a.code,
      registration: a.regNo ?? undefined,
      serialNo: a.serialNo ?? undefined,
      status: a.status,
    })),
    sites: projects.map((p) => ({ localId: p.id, name: p.name, code: p.code })),
  });
}
