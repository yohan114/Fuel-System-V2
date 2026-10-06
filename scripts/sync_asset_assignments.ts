import { prisma } from "../src/lib/db";

async function main() {
  console.log("=== SYNC ASSET ASSIGNMENTS FROM SITE PINS ===");

  const sysUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (!sysUser) throw new Error("No ADMIN user found");

  const assets = await prisma.asset.findMany({
    where: { projectId: { not: null }, status: { not: "DISPOSED" } },
    include: {
      project: true,
      assignments: {
        where: { endDate: null },
      },
    },
  });

  const now = new Date();
  // Use Colombo start of month or today so bills stay intact
  const todayStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const dayBefore = new Date(todayStart);
  dayBefore.setDate(dayBefore.getDate() - 1);

  let synced = 0;
  for (const a of assets) {
    const hasActive = a.assignments.some((asg) => asg.projectId === a.projectId);
    if (!hasActive) {
      // Close open assignments to other projects
      for (const openAsg of a.assignments) {
        if (openAsg.projectId !== a.projectId) {
          await prisma.assetAssignment.update({
            where: { id: openAsg.id },
            data: { endDate: openAsg.startDate <= dayBefore ? dayBefore : openAsg.startDate },
          });
        }
      }

      // Create ongoing assignment for current project
      await prisma.assetAssignment.create({
        data: {
          assetId: a.id,
          projectId: a.projectId!,
          startDate: todayStart,
          endDate: null,
          note: "Synced from asset site allocation",
          origin: "MANUAL",
          createdById: sysUser.id,
        },
      });
      synced++;
    }
  }

  // Also link any SITE_PUMP user without bulkTankId to their site tank if available
  const sitePumpUsers = await prisma.user.findMany({
    where: { role: "SITE_PUMP", bulkTankId: null, projectId: { not: null } },
  });
  for (const u of sitePumpUsers) {
    const tank = await prisma.bulkTank.findFirst({
      where: { projectId: u.projectId },
    });
    if (tank) {
      await prisma.user.update({
        where: { id: u.id },
        data: { bulkTankId: tank.id },
      });
      console.log(`Linked user ${u.username} to bulk tank ${tank.name}`);
    }
  }

  console.log(`Successfully synced ${synced} assets with ongoing assignments to their assigned sites.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
