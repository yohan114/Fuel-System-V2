import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import WorkshopConsole from "./WorkshopConsole";

export default async function WorkshopPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "WORKSHOP")) {
    redirect("/");
  }

  // Find the workshop user's assigned tank
  let tank = null;
  if (session.bulkTankId) {
    tank = await prisma.bulkTank.findUnique({
      where: { id: session.bulkTankId },
    });
  } else if (session.role === "ADMIN") {
    // Admin can view the first tank by default
    tank = await prisma.bulkTank.findFirst();
  }

  // Fetch all tanks for selection (especially for admins)
  const allTanks = await prisma.bulkTank.findMany({
    orderBy: { name: "asc" },
  });

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

  // Fetch recent dispatches from this tank
  const recentIssues = tank
    ? await prisma.fuelIssue.findMany({
        where: { bulkTankId: tank.id },
        include: { asset: true, issuedBy: true },
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
  
  const colomboHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Colombo",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  
  const isLocked = colomboHour < 8 || colomboHour >= 17;
  const lockMessage = isLocked
    ? (colomboHour < 8 ? "Closed (Opens at 08:00 AM)" : "Closed (Locked at 17:00 PM)")
    : "Open (Locks at 17:00 PM)";
    
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
    />
  );
}
