import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { visibleAssetIdsForUser } from "@/lib/assignments";
import WorkshopConsole from "../workshop/WorkshopConsole";

// Site Pump Console — the site-scoped analog of the Workshop Console. A
// SITE_PUMP operator issues fuel from their site's bulk tank and requests
// replenishment, reusing the same console UI with a site title. (Like the
// workshop pump, the vehicle list is unscoped for issuing — a site pump may
// fuel any vehicle that pulls up; cost is attributed by the vehicle's
// assignment, not by the issuing pump.)
export default async function SitePumpPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "SITE_PUMP")) {
    redirect("/");
  }

  // The site pump operator's assigned tank.
  let tank = null;
  if (session.bulkTankId) {
    tank = await prisma.bulkTank.findUnique({ where: { id: session.bulkTankId } });
  } else if (session.role === "ADMIN") {
    tank = await prisma.bulkTank.findFirst();
  }

  const allTanks = await prisma.bulkTank.findMany({ orderBy: { name: "asc" } });

  // Scope the asset picker to vehicles allocated to this operator's site (active
  // assignment that day + legacy-pinned). null = admin, no restriction.
  const visibleIds = await visibleAssetIdsForUser(session, new Date());
  const assets = await prisma.asset.findMany({
    where: {
      status: { not: "DISPOSED" },
      ...(visibleIds ? { id: { in: [...visibleIds] } } : {}),
    },
    select: { id: true, code: true, regNo: true, meterType: true },
    orderBy: { code: "asc" },
  });

  const recentIssues = tank
    ? await prisma.fuelIssue.findMany({
        where: { bulkTankId: tank.id },
        include: { asset: true, issuedBy: true },
        take: 10,
        orderBy: { issueDate: "desc" },
      })
    : [];

  const bulkRequests = tank
    ? await prisma.bulkRequest.findMany({
        where: { bulkTankId: tank.id },
        take: 10,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const projects = await prisma.project.findMany({ orderBy: { name: "asc" } });

  const now = new Date();
  const colomboTodayStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const [colomboYear, colomboMonth, colomboDay] = colomboTodayStr.split("-").map(Number);

  const isLocked = false;
  const lockMessage = "Open (24/7)";

  const colomboMidnight = new Date(colomboYear, colomboMonth - 1, colomboDay);
  const minDate = new Date(colomboMidnight.getTime() - 14 * 24 * 60 * 60 * 1000);
  const minDateStr = minDate.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

  return (
    <WorkshopConsole
      currentTank={tank}
      allTanks={allTanks}
      assets={assets}
      recentIssues={recentIssues}
      bulkRequests={bulkRequests}
      projects={projects}
      role={session.role}
      isLocked={isLocked}
      lockMessage={lockMessage}
      todayStr={colomboTodayStr}
      minDateStr={minDateStr}
      title="Site Pump Console"
      // A site operator records the delivery that just happened rather than
      // asking permission for one, and does not carry the stock figure.
      immediateRefuel
      hideStock
    />
  );
}
