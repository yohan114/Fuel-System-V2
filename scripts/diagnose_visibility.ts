import { prisma } from "../src/lib/db";
import fs from "fs";
import path from "path";

// Why does a screen show nothing?
//
// An empty fleet directory has several causes that look identical from the
// outside: the login is scoped to a site with no machines, every machine is
// marked DISPOSED, or the app is reading a different database from the one the
// scripts wrote to. This answers which.
//
// Read-only.
//
//   npx tsx scripts/diagnose_visibility.ts

function announceDatabase() {
  const url = process.env.FUEL_DATABASE_URL || process.env.DATABASE_URL || "file:./data/app.db";
  const abs = path.resolve(process.cwd(), url.replace(/^file:/, ""));
  console.log(`  database: ${abs}${fs.existsSync(abs) ? "" : "   << DOES NOT EXIST"}`);
  if (!process.env.FUEL_DATABASE_URL && !process.env.DATABASE_URL)
    console.log(`  (default — set FUEL_DATABASE_URL if the running app uses a different file)`);
  return abs;
}

async function main() {
  console.log(`\n=== what can be seen, and by whom ===`);
  const abs = announceDatabase();
  // The app resolves its database the same way; if .env names another file, the
  // scripts and the site have been looking at different data all along.
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/)
      .filter((l) => /^\s*(FUEL_)?DATABASE_URL\s*=/.test(l)).pop();
    if (line) {
      const appDb = path.resolve(process.cwd(), line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "").replace(/^file:/, ""));
      console.log(`  .env says the APP uses: ${appDb}`);
      if (appDb !== abs) console.log(`  ! THESE ARE DIFFERENT FILES — the site is not reading what the scripts wrote`);
    }
  }

  // Pointing at the wrong file is easy — a typo, an unexpanded placeholder, a
  // path that does not exist yet. SQLite answers by creating an empty file
  // rather than complaining, so the first query is where it surfaces. Say what
  // happened instead of unwinding a Prisma stack over it.
  // Counted with a plain findMany rather than groupBy: the shape is simple, and
  // groupBy's generics make the catch below hard to type for no gain.
  let byStatus: { status: string; n: number }[];
  try {
    const rows = await prisma.asset.findMany({ select: { status: true } });
    const tally = new Map<string, number>();
    for (const r of rows) tally.set(r.status, (tally.get(r.status) ?? 0) + 1);
    byStatus = [...tally].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2021" || /no such table/i.test(String(e))) {
      console.log(`\n  THAT FILE IS NOT A FUEL-SYSTEM DATABASE — it has no Asset table.`);
      console.log(`  SQLite creates an empty file rather than failing, so a mistyped path`);
      console.log(`  looks like an empty system. Check the path above against .env:\n`);
      console.log(`      grep DATABASE_URL .env\n`);
      return;
    }
    throw e;
  }
  console.log(`\n--- machines by status ---`);
  for (const s of byStatus) console.log(`  ${s.status.padEnd(10)} ${s.n}`);
  const visible = byStatus.filter((s) => s.status === "ACTIVE" || s.status === "INACTIVE").reduce((n, s) => n + s.n, 0);
  console.log(`  the fleet directory shows ACTIVE + INACTIVE = ${visible}`);
  if (visible === 0) console.log(`  ! nothing would show for ANY login`);

  const users = await prisma.user.findMany({
    select: { name: true, email: true, role: true,
      project: { select: { code: true, name: true } },
      bulkTank: { select: { name: true } } },
    orderBy: { role: "asc" } });
  const SITE_ROLES = new Set(["USER", "SITE_PUMP"]);
  console.log(`\n--- ${users.length} logins ---`);
  for (const u of users) {
    const scoped = SITE_ROLES.has(u.role) && u.project;
    let note = "";
    if (SITE_ROLES.has(u.role)) {
      if (!u.project) note = "  <- site role with NO site: sees nothing";
      else {
        const n = await prisma.asset.count({ where: { status: { in: ["ACTIVE", "INACTIVE"] }, project: { code: u.project.code } } });
        note = `  <- sees only ${u.project.code}: ${n} machine(s)${n === 0 ? "  ** THIS LOGIN SEES AN EMPTY FLEET **" : ""}`;
      }
    } else note = `  <- ${u.role} is not site-scoped: sees all ${visible}`;
    console.log(`  ${(u.email ?? u.name ?? "—").padEnd(34)} ${u.role.padEnd(10)} site=${u.project?.code ?? "—"}  pump=${u.bulkTank?.name ?? "—"}${note}`);
    void scoped;
  }

  const orphans = await prisma.user.count({ where: { projectId: { not: null }, project: { is: null } } });
  if (orphans) console.log(`\n  ! ${orphans} login(s) point at a site that no longer exists`);

  console.log(`\n--- machines per site (ACTIVE + INACTIVE) ---`);
  const projects = await prisma.project.findMany({ select: { code: true }, orderBy: { code: "asc" } });
  for (const p of projects) {
    const n = await prisma.asset.count({ where: { status: { in: ["ACTIVE", "INACTIVE"] }, project: { code: p.code } } });
    if (n) console.log(`  ${p.code.padEnd(14)} ${n}`);
  }
  const unpinned = await prisma.asset.count({ where: { status: { in: ["ACTIVE", "INACTIVE"] }, projectId: null } });
  console.log(`  ${"(no site)".padEnd(14)} ${unpinned}`);
  console.log("");
}

main().finally(() => prisma.$disconnect());
