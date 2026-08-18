import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthStartDate(y: number, m: number) {
  return new Date(y, m - 1, 1, 0, 0, 0, 0);
}

function monthEndDate(y: number, m: number) {
  const d = getDaysInMonth(y, m);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

async function main() {
  console.log("=== Rebuilding Asset Assignments ===");

  // 1. Fetch all imported assignments before deleting them (any assignment not created as a resolved segment)
  const importedAssignments = await prisma.assetAssignment.findMany({
    where: {
      NOT: {
        note: {
          startsWith: "Resolved chronological assignment"
        }
      }
    },
    include: { project: true }
  });
  console.log(`Found ${importedAssignments.length} imported/retained assignments in database.`);

  const importedMap = new Map<string, string>(); // key: `${assetId}_${year}_${month}`, value: projectCode
  for (const assign of importedAssignments) {
    if (assign.project) {
      const date = new Date(assign.startDate);
      const key = `${assign.assetId}_${date.getFullYear()}_${date.getMonth() + 1}`;
      importedMap.set(key, assign.project.code);
    }
  }

  // Delete all existing assignments
  await prisma.assetAssignment.deleteMany();
  console.log("Deleted all old AssetAssignment records.");

  const assets = await prisma.asset.findMany({
    where: { status: { not: "DISPOSED" } },
    include: { project: true }
  });

  // We will scan from Jan 2025 to May 2026
  const startYear = 2025, startMonth = 1;
  const endYear = 2026, endMonth = 5;

  const periods: { year: number; month: number }[] = [];
  let currY = startYear, currM = startMonth;
  while (currY < endYear || (currY === endYear && currM <= endMonth)) {
    periods.push({ year: currY, month: currM });
    currM++;
    if (currM > 12) {
      currM = 1;
      currY++;
    }
  }

  let assignmentsCreated = 0;

  for (const asset of assets) {
    for (const p of periods) {
      const pStart = monthStartDate(p.year, p.month);
      const pEnd = monthEndDate(p.year, p.month);
      const days = getDaysInMonth(p.year, p.month);

      // Find fuel issues in this month
      const fuelIssues = await prisma.fuelIssue.findMany({
        where: { assetId: asset.id, issueDate: { gte: pStart, lte: pEnd }, voided: false },
        orderBy: { issueDate: "asc" }
      });

      // Find meter readings in this month
      const readings = await prisma.meterReading.findMany({
        where: { assetId: asset.id, readingDate: { gte: pStart, lte: pEnd } },
        orderBy: { readingDate: "asc" }
      });

      // Map day -> project code
      const dayMap = new Array<string | null>(days).fill(null);

      // 1. Process fuel issues to assign days
      for (const f of fuelIssues) {
        const day = new Date(f.issueDate).getDate() - 1; // 0-indexed
        let code = f.source;
        if (code === "BADALGAMA" || code === "BADAL") code = "BADAL";
        if (code) {
          dayMap[day] = code;
        }
      }

      // 2. Process meter readings to assign days
      for (const r of readings) {
        const day = new Date(r.readingDate).getDate() - 1; // 0-indexed
        let code: string | null = null;
        if (r.source.startsWith("CEP-03-ABC")) {
          code = "CEP-03-ABC";
        } else if (r.source.startsWith("DAILY_SHEET")) {
          code = "CEP-03";
        } else if (r.source.startsWith("SUMMARY_")) {
          // e.g. SUMMARY_MARA_START -> MARA
          const parts = r.source.split("_");
          if (parts.length >= 3) {
            code = parts.slice(1, -1).join("_");
          }
        }
        if (code && !dayMap[day]) {
          dayMap[day] = code;
        }
      }

      // 3. Resolve active projects in this month
      const activeProjects = Array.from(new Set(dayMap.filter(Boolean))) as string[];

      if (activeProjects.length === 0) {
        // No activity this month. Check if there was an imported/retained assignment.
        const key = `${asset.id}_${p.year}_${p.month}`;
        const importedProjectCode = importedMap.get(key);

        if (importedProjectCode) {
          const proj = await prisma.project.findUnique({ where: { code: importedProjectCode } });
          if (proj) {
            await prisma.assetAssignment.create({
              data: {
                assetId: asset.id,
                projectId: proj.id,
                startDate: pStart,
                endDate: pEnd,
                note: "Idle month assignment (retained from import)"
              }
            });
            assignmentsCreated++;
          }
        }
        continue;
      }

      // 4. Fill in gaps (interpolate/carry forward)
      let currentActiveProj = activeProjects[0];
      for (let d = 0; d < days; d++) {
        if (dayMap[d]) {
          currentActiveProj = dayMap[d]!;
        } else {
          dayMap[d] = currentActiveProj;
        }
      }

      // 5. Compress contiguous segments
      let startDay = 0;
      let prevCode = dayMap[0]!;
      for (let d = 1; d <= days; d++) {
        const currentCode = d < days ? dayMap[d] : null;
        if (currentCode !== prevCode) {
          // Write segment from startDay to d-1
          const segStart = new Date(p.year, p.month - 1, startDay + 1, 0, 0, 0, 0);
          const segEnd = new Date(p.year, p.month - 1, d, 23, 59, 59, 999);

          const proj = await prisma.project.findUnique({ where: { code: prevCode } });
          if (proj) {
            await prisma.assetAssignment.create({
              data: {
                assetId: asset.id,
                projectId: proj.id,
                startDate: segStart,
                endDate: segEnd,
                note: `Resolved chronological assignment (${p.year}-${String(p.month).padStart(2, "0")})`
              }
            });
            assignmentsCreated++;
          }

          if (currentCode) {
            startDay = d;
            prevCode = currentCode;
          }
        }
      }
    }
  }

  console.log(`Successfully created ${assignmentsCreated} chronological, non-overlapping assignments.`);
  await prisma.$disconnect();
}

main().catch(console.error);
