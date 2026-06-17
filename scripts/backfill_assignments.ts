import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// One-off backfill: turn each vehicle's current Asset.projectId "pin" into an
// explicit, ongoing AssetAssignment so the new assignment-driven scoping and
// per-site billing take over going forward.
//
// The start date defaults to the FIRST DAY OF THE CURRENT MONTH so that
// previously generated (historical) bills keep using the legacy single-site
// path and are reproduced unchanged. Override with START_DATE=YYYY-MM-DD.
//
//   npx tsx scripts/backfill_assignments.ts

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

function resolveStart(): Date {
  const raw = process.env.START_DATE;
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

async function main() {
  const startDate = resolveStart();
  console.log(`Backfilling assignments with start date ${startDate.toDateString()}…`);

  const assets = await prisma.asset.findMany({
    where: { projectId: { not: null }, assignments: { none: {} } },
    select: { id: true, code: true, projectId: true },
  });

  let created = 0;
  for (const a of assets) {
    if (!a.projectId) continue;
    await prisma.assetAssignment.create({
      data: { assetId: a.id, projectId: a.projectId, startDate, endDate: null, note: "Backfilled from current site pin" },
    });
    created++;
  }

  console.log(`Created ${created} ongoing assignment(s) for ${assets.length} pinned vehicle(s).`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
