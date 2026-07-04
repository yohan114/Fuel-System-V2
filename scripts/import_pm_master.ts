/**
 * Import the Fleet PM Master workbook (preventive-maintenance plans).
 *
 * Each category sheet lists tasks on the hour ladder (Daily/10 h …
 * Major/4000 h+): system, component, description, consumables/parts, skill,
 * labor and safety notes. Tasks land on PMTask keyed by the app Category, so
 * every vehicle of the category shares the plan (see /service/plan/[code]).
 *
 * Idempotent: re-importing replaces workbook-sourced tasks (taskCode set) and
 * leaves manually added tasks (taskCode null) untouched.
 *
 * Reads ./Fleet_PM_Master.xlsx (committed master) — override with PM_MASTER=path.
 */
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./data/app.db" });
const prisma = new PrismaClient({ adapter });

const FILE = process.env.PM_MASTER || path.join(process.cwd(), "Fleet_PM_Master.xlsx");
// "General Workshop" is reference guidance (greases, torque tables) without
// scheduling intervals — not a vehicle PM plan, so it is skipped.
const SKIP_SHEETS = new Set(["README", "Fleet Register", "PM Matrix Summary", "General Workshop"]);
// Sheet name → category code where normalization alone cannot match.
const ALIASES: Record<string, string> = {};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function intervalHoursOf(label: string): number | null {
  const m = label.match(/(\d+)\s*h/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`PM master workbook not found at ${FILE}`);
    process.exit(1);
  }
  const wb = XLSX.readFile(FILE, { cellDates: false });
  const categories = await prisma.category.findMany();
  const byNorm = new Map(categories.map((c) => [norm(c.name), c]));
  const byCode = new Map(categories.map((c) => [c.code, c]));

  const matched: { sheet: string; category: string; tasks: number }[] = [];
  const unmatched: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue;

    const ns = norm(sheetName);
    let category =
      byNorm.get(ns) ??
      (ALIASES[ns] ? byCode.get(ALIASES[ns]) : undefined) ??
      categories.find((c) => norm(c.name).startsWith(ns) || ns.startsWith(norm(c.name)));
    if (!category) {
      unmatched.push(sheetName);
      continue;
    }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: "" });
    const tasks: {
      taskCode: string;
      intervalHours: number;
      intervalLabel: string;
      system: string | null;
      component: string | null;
      description: string;
      parts: string | null;
      skill: string | null;
      laborHours: number | null;
      notes: string | null;
      sortOrder: number;
    }[] = [];

    for (const raw of rows.slice(1)) {
      const r = raw as string[];
      const taskCode = String(r[0] ?? "").trim();
      const intervalLabel = String(r[1] ?? "").trim();
      if (!taskCode || taskCode.startsWith("—") || !intervalLabel) continue; // section separators
      const intervalHours = intervalHoursOf(intervalLabel);
      if (intervalHours == null) continue;
      const description = String(r[4] ?? "").trim();
      if (!description) continue;
      const labor = parseFloat(String(r[7] ?? ""));
      tasks.push({
        taskCode,
        intervalHours,
        intervalLabel,
        system: String(r[2] ?? "").trim() || null,
        component: String(r[3] ?? "").trim() || null,
        description,
        parts: String(r[5] ?? "").trim().replace(/^—$/, "") || null,
        skill: String(r[6] ?? "").trim() || null,
        laborHours: isNaN(labor) ? null : labor,
        notes: String(r[8] ?? "").trim() || null,
        sortOrder: tasks.length,
      });
    }

    await prisma.$transaction([
      prisma.pMTask.deleteMany({ where: { categoryId: category.id, taskCode: { not: null } } }),
      prisma.pMTask.createMany({ data: tasks.map((t) => ({ ...t, categoryId: category!.id })) }),
    ]);
    matched.push({ sheet: sheetName, category: category.name, tasks: tasks.length });
  }

  console.log("── PM Master import ─────────────────────────");
  for (const m of matched) console.log(`  ${m.sheet.padEnd(22)} → ${m.category.padEnd(28)} ${m.tasks} tasks`);
  if (unmatched.length) console.log(`  ⚠ unmatched sheets: ${unmatched.join(", ")}`);
  const noPlan = categories.filter(
    (c) => !matched.some((m) => m.category === c.name) && !c.name.startsWith("PE - ")
  );
  if (noPlan.length) console.log(`  ⚠ categories without a plan: ${noPlan.map((c) => c.name).join(", ")}`);
  const total = await prisma.pMTask.count();
  console.log(`  Total PM tasks in database: ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
