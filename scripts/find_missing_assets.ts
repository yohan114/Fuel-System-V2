import { prisma } from "../src/lib/db";

async function test() {
  const assets = await prisma.asset.findMany({
    where: { projectId: { not: null }, status: { not: "DISPOSED" } },
    include: {
      project: true,
      assignments: {
        where: { endDate: null },
      },
    },
  });

  let needsSync = 0;
  for (const a of assets) {
    const hasActiveForCurrentProject = a.assignments.some(
      (asg) => asg.projectId === a.projectId
    );
    if (!hasActiveForCurrentProject) {
      needsSync++;
      console.log(
        `Asset ${a.code} (ID: ${a.id}) is set to project ${a.project?.code}, but has no active assignment to it. Active assignments to other projects: ${a.assignments.map((asg) => asg.projectId).join(", ") || "none"}`
      );
    }
  }
  console.log(`Total assets needing assignment sync: ${needsSync} / ${assets.length}`);
}

test().finally(() => prisma.$disconnect());
