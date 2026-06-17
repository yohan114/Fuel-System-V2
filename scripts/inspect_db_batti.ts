import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const project = await prisma.project.findUnique({
    where: { code: "BATTI" },
    include: {
      assets: {
        include: {
          category: true,
        }
      }
    }
  });

  if (!project) {
    console.log("Project BATTI not found");
    return;
  }

  console.log(`Project: ${project.name} (${project.code})`);
  console.log(`Total Assets: ${project.assets.length}`);
  console.log("ASSETS:");
  for (const a of project.assets) {
    console.log(`- Code: ${a.code} | Reg: ${a.regNo} | Category: ${a.category.code} (${a.category.name}) | TypeLabel: ${a.typeLabel}`);
  }

  // Let's also check all fuel issues for project BATTI
  const issues = await prisma.fuelIssue.findMany({
    where: { source: "BATTI" },
    include: {
      asset: true,
    }
  });
  console.log(`\nTotal Fuel Issues for BATTI: ${issues.length}`);
  const uniqueAssets = new Set(issues.map(i => i.asset.code));
  console.log(`Unique assets with fuel issues:`, [...uniqueAssets]);
}

main().catch(console.error).finally(() => prisma.$disconnect());
