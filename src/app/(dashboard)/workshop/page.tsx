import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { toTankView } from "@/lib/tank-visibility";
import { isWorkshopTank } from "@/lib/fuel/workshop-pump";
import { ymd } from "@/lib/fuel/issue-report";
import WorkshopConsole from "./WorkshopConsole";
import TankTiles, { type TankTile } from "./TankTiles";

export default async function WorkshopPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "WORKSHOP")) {
    redirect("/");
  }

  const isAdmin = session.role === "ADMIN";

  // Find the workshop user's assigned tank
  let tank = null;
  if (session.bulkTankId) {
    tank = await prisma.bulkTank.findUnique({
      where: { id: session.bulkTankId },
    });
  } else if (isAdmin) {
    // Admin defaults to the central workshop pump, falling back to any tank.
    const all = await prisma.bulkTank.findMany({ orderBy: { name: "asc" } });
    tank = all.find(isWorkshopTank) ?? all[0] ?? null;
  }

  // Fetch all tanks for selection (especially for admins)
  const allTanks = await prisma.bulkTank.findMany({
    orderBy: { name: "asc" },
  });

  // Admin-only pump overview. Litres issued per tank over the current month give
  // the tiles a throughput figure alongside the stock level.
  let tiles: TankTile[] = [];
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

  if (isAdmin) {
    const [tankProjects, issuedByTank] = await Promise.all([
      prisma.project.findMany({ select: { id: true, code: true } }),
      prisma.fuelIssue.groupBy({
        by: ["bulkTankId"],
        where: { voided: false, issueDate: { gte: monthStart, lte: monthEnd } },
        _sum: { litres: true },
      }),
    ]);
    const codeById = new Map(tankProjects.map((p) => [p.id, p.code]));
    const litresByTank = new Map(issuedByTank.map((g) => [g.bulkTankId, g._sum.litres ?? 0]));

    tiles = allTanks.map((t) => ({
      id: t.id,
      name: t.name,
      fuelKind: t.fuelKind,
      balance: t.balance,
      capacity: t.capacity,
      siteId: t.projectId,
      siteCode: t.projectId ? codeById.get(t.projectId) ?? null : null,
      isWorkshop: isWorkshopTank(t),
      issuedLitres: litresByTank.get(t.id) ?? 0,
    }));
  }

  // Fetch assets list for autofilling (no scoping for workshop pumps!)
  const assets = await prisma.asset.findMany({
    where: { status: { not: "DISPOSED" } },
    select: {
      id: true,
      code: true,
      regNo: true,
      meterType: true,
    },
    orderBy: { code: "asc" },
  });

  // Fetch recent dispatches from this tank. These rows are passed as props to
  // WorkshopConsole (a client component), so everything selected here is
  // serialized into the RSC payload and is readable in the browser. Select only
  // the fields IssueProp declares — `include: { issuedBy: true }` would ship the
  // whole User row, bcrypt passwordHash included.
  const recentIssues = tank
    ? await prisma.fuelIssue.findMany({
        where: { bulkTankId: tank.id },
        select: {
          id: true,
          fuelKind: true,
          litres: true,
          meterReading: true,
          readingType: true,
          totalCost: true,
          issueDate: true,
          asset: { select: { code: true, regNo: true } },
          issuedBy: { select: { name: true } },
        },
        take: 10,
        orderBy: { issueDate: "desc" },
      })
    : [];

  // Fetch replenishment requests for this tank
  const bulkRequests = tank
    ? await prisma.bulkRequest.findMany({
        where: { bulkTankId: tank.id },
        take: 10,
        orderBy: { createdAt: "desc" },
      })
    : [];

  // Fetch projects list
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
  });

  // Calculate Colombo timezone date/time variables on the server to prevent client hydration mismatch
  const now = new Date();
  const colomboTodayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [colomboYear, colomboMonth, colomboDay] = colomboTodayStr.split("-").map(Number);
  
  // Fuel issuing is allowed 24/7 — the 08:00–17:00 lock has been removed.
  const isLocked = false;
  const lockMessage = "Open (24/7)";
    
  const colomboMidnight = new Date(colomboYear, colomboMonth - 1, colomboDay);
  const minDate = new Date(colomboMidnight.getTime() - 14 * 24 * 60 * 60 * 1000);
  const minDateStr = minDate.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

  // Admins get the pump overview only. The console below it is the operator's
  // dispatch tool — an admin cannot issue fuel from it anyway
  // (workshopIssueFuelAction requires the WORKSHOP role), so showing it here
  // was dead weight.
  if (isAdmin) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide">Pump Overview</h2>
          <p className="text-xs text-gray-400 mt-1">
            Stock across every pump. Click any tank to see that site&apos;s fuel issues,
            filter by vehicle and date, and download a PDF or Excel report.
          </p>
        </div>
        <TankTiles tanks={tiles} from={ymd(monthStart)} to={ymd(monthEnd)} />
      </div>
    );
  }

  return (
    <WorkshopConsole
      currentTank={tank ? toTankView(tank, session.role) : null}
      allTanks={allTanks.map((t) => toTankView(t, session.role))}
      assets={assets}
      recentIssues={recentIssues}
      bulkRequests={bulkRequests}
      projects={projects}
      role={session.role}
      isLocked={isLocked}
      lockMessage={lockMessage}
      todayStr={colomboTodayStr}
      minDateStr={minDateStr}
    />
  );
}
