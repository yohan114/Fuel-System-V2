import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import WorkshopConsole from "./WorkshopConsole";
import PumpOverview, { PumpCard } from "./PumpOverview";
import PumpIssuePanel from "./PumpIssuePanel";

export default async function WorkshopPage(props: { searchParams: Promise<{ tank?: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "WORKSHOP")) {
    redirect("/");
  }

  const tankParam = (await props.searchParams).tank?.trim() || "";

  // ?tank= means "record into this pump", and only an admin may aim it at a
  // pump that is not their own. An operator arriving with someone else's id —
  // by a shared link or by editing the address — is sent back to their own
  // console rather than shown a form that would refuse them at submit time.
  if (tankParam && session.role !== "ADMIN") {
    if (tankParam !== session.bulkTankId) redirect("/workshop");
  }

  // An operator is posted to one pump and wants to work it. An admin owns all of
  // them and wants the estate: which are dry, which hold stock, where today's
  // fuel went. Showing an admin a single arbitrary tank — whichever came back
  // first — answered a question nobody asked.
  // An admin who named a pump gets the panel that records into it. This is the
  // route the Pump Overview's "Record issue" button opens, and the only way for
  // the office to key a site's fuel without borrowing that site's login.
  if (session.role === "ADMIN" && tankParam) {
    const picked = await prisma.bulkTank.findUnique({
      where: { id: tankParam },
      include: { project: { select: { code: true, name: true } } },
    });
    // A stale link should show the estate, not a stack trace.
    if (picked) {
      const assets = await prisma.asset.findMany({
        where: { status: { not: "DISPOSED" } },
        select: { id: true, code: true, regNo: true, meterType: true },
        orderBy: { code: "asc" },
      });
      // Colombo "now" for the datetime-local default, computed here so the
      // first render cannot disagree with the browser's clock.
      const nowLocal = new Date()
        .toLocaleString("sv-SE", { timeZone: "Asia/Colombo" })
        .replace(" ", "T")
        .slice(0, 16);
      return (
        <PumpIssuePanel
          tank={{
            id: picked.id,
            name: picked.name,
            fuelKind: picked.fuelKind,
            balance: picked.balance,
            capacity: picked.capacity,
            projectCode: picked.project?.code ?? null,
            projectName: picked.project?.name ?? null,
            isWorkshop: /workshop/i.test(picked.project?.name ?? picked.name),
          }}
          assets={assets}
          nowLocal={nowLocal}
        />
      );
    }
  }

  if (session.role === "ADMIN" && !session.bulkTankId) {
    const tanks = await prisma.bulkTank.findMany({
      include: { project: { select: { code: true, name: true } } },
      orderBy: { name: "asc" },
    });

    // "Today" is the operator's day in Colombo, not the server's in UTC.
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
    const dayStart = new Date(`${todayStr}T00:00:00+05:30`);
    const dayEnd = new Date(`${todayStr}T23:59:59.999+05:30`);
    const issuedToday = await prisma.fuelIssue.groupBy({
      by: ["bulkTankId"],
      where: { voided: false, issueDate: { gte: dayStart, lte: dayEnd } },
      _sum: { litres: true },
    });
    const byTank = new Map(issuedToday.map((r) => [r.bulkTankId, r._sum.litres || 0]));

    const pumps: PumpCard[] = tanks.map((t) => ({
      id: t.id,
      name: t.name,
      fuelKind: t.fuelKind,
      capacity: t.capacity,
      balance: t.balance,
      projectCode: t.project?.code ?? null,
      projectName: t.project?.name ?? null,
      issuedToday: byTank.get(t.id) || 0,
      // The workshop pump is the one that may fuel anything, wherever it sits;
      // every other pump is bound to its own site's vehicles.
      isWorkshop: /workshop/i.test(t.project?.name ?? t.name),
    }));

    return <PumpOverview pumps={pumps} />;
  }

  // Find the workshop user's assigned tank
  let tank = null;
  if (session.bulkTankId) {
    tank = await prisma.bulkTank.findUnique({
      where: { id: session.bulkTankId },
    });
  }
  // No arbitrary-tank fallback. An admin holding a bulkTankId gets their own
  // pump; one without gets the overview above and picks. `findFirst()` handed
  // whichever row came back first, which is never the pump anybody meant — the
  // same reasoning as the overview branch, which this used to contradict.

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

  // Fetch recent dispatches from this tank. These rows are props for
  // WorkshopConsole ("use client"), so whatever is selected here is serialized
  // into the RSC payload and is readable in page source. `include: { issuedBy }`
  // returns every User scalar, which put each operator's bcrypt passwordHash on
  // the wire. IssueProp only ever declared `issuedBy: { name }`; structural
  // typing accepted the wider object without complaint. Select exactly the
  // declared fields.
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
  let minDateStr = minDate.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

  // 20-hour access bypass for June 1st and June 2nd, 2026
  const nowTime = new Date();
  const bypassExpiry = new Date("2026-06-19T10:04:11.000Z");
  if (nowTime < bypassExpiry) {
    minDateStr = "2026-06-01";
  }

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
      // The operator keeps the balance — they are the one who notices the pump
      // is running low and asks for a delivery — but how much the tank holds is
      // management's figure. An admin looking at the same console still sees it.
      hideCapacity={session.role === "WORKSHOP"}
    />
  );
}
