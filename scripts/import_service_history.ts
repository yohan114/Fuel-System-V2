// Imports historical service records from the Service Record system's
// "Service record.xlsx" (the `Summery` sheet) into the merged ServiceRecord
// tables. Each row is matched to a live Asset by E&C code or registration;
// unmatched rows are reported and skipped (the fleet is the source of truth).
// Historical rows have no prices, so totals are left at 0.
//
// Run (dry run first):
//   DATABASE_URL="file:./data/app.db" SERVICE_RECORD_DIR=/home/user/service-record \
//     npx tsx scripts/import_service_history.ts --dry-run
//   …then drop --dry-run to write.
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/db";

const norm = (s: unknown) => (s || "").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");

function parseHistDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}
function parseMeter(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const COLS = ["date", "jobNo", "vehicleRaw", "site", "sm", "nsm", "oilQty", "oilFilter", "fuel1", "fuel2", "lineFilter", "airInner", "airOuter", "gearTrans", "hyFilter", "remarks"];
const FILTER_MAP: [string, string][] = [
  ["oilFilter", "Engine Oil Filter"], ["fuel1", "Primary Fuel Filter"], ["fuel2", "Water Separator"],
  ["lineFilter", "Line Filter"], ["airInner", "Air Filter Inner"], ["airOuter", "Air Filter Outer"],
  ["gearTrans", "Trans: Filter"], ["hyFilter", "Hydraulic Filter - S"],
];

export interface HistoryStats {
  rows: number;
  matched: number;
  unmatched: number;
  noDate: number;
  dup: number;
  created: number;
  unmatchedSamples: string[];
}

export async function importServiceHistory(opts: { dir: string; dryRun: boolean }): Promise<HistoryStats> {
  const { dir, dryRun } = opts;
  const file = path.join(dir, "Service record.xlsx");
  if (!fs.existsSync(file)) throw new Error("Not found: " + file);

  const ws = XLSX.readFile(file).Sheets["Summery"];
  if (!ws) throw new Error("No 'Summery' sheet in the workbook");
  const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  const records = raw.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    COLS.forEach((k, j) => (rec[k] = r[j] == null ? "" : String(r[j]).trim()));
    rec._dateRaw = r[0] == null ? "" : String(r[0]);
    return rec;
  }).filter((rec) => rec.vehicleRaw);

  console.log(`Read ${records.length} history rows from ${file}${dryRun ? "  (DRY RUN)" : ""}`);

  // Attribute imported history to an admin user.
  const user =
    (await prisma.user.findFirst({ where: { username: process.env.SERVICE_IMPORT_USER || "admin" } })) ||
    (await prisma.user.findFirst({ where: { role: "ADMIN" } }));
  if (!user) throw new Error("No admin user found to attribute history to — seed the database first.");

  // Asset lookup maps (by E&C code, then registration).
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true, meterType: true } });
  const codeMap = new Map<string, (typeof assets)[number]>();
  const regMap = new Map<string, (typeof assets)[number]>();
  for (const a of assets) {
    codeMap.set(norm(a.code), a);
    if (a.regNo) regMap.set(norm(a.regNo), a);
  }
  const matchAsset = (vehicleRaw: string) => {
    const tokens = new Set<string>([norm(vehicleRaw)]);
    for (const t of vehicleRaw.split(/[(),/\s]+/)) if (t && t.length >= 2) tokens.add(norm(t));
    for (const t of tokens) if (codeMap.has(t)) return codeMap.get(t)!;
    for (const t of tokens) if (regMap.has(t)) return regMap.get(t)!;
    return null;
  };

  // Preload existing (assetId|date|jobNo) keys so re-runs don't duplicate.
  const existing = new Set(
    (await prisma.serviceRecord.findMany({ select: { assetId: true, serviceDate: true, jobNo: true } })).map(
      (r) => `${r.assetId}|${r.serviceDate.toISOString().slice(0, 10)}|${r.jobNo || ""}`
    )
  );

  let matched = 0, unmatched = 0, noDate = 0, dup = 0, created = 0;
  const unmatchedSamples: string[] = [];

  for (const h of records) {
    const asset = matchAsset(h.vehicleRaw);
    if (!asset) {
      unmatched++;
      if (unmatchedSamples.length < 15) unmatchedSamples.push(h.vehicleRaw);
      continue;
    }
    matched++;
    const date = parseHistDate(h._dateRaw);
    if (!date) { noDate++; continue; }
    const key = `${asset.id}|${date.toISOString().slice(0, 10)}|${h.jobNo || ""}`;
    if (existing.has(key)) { dup++; continue; }
    existing.add(key);

    const filters = FILTER_MAP.filter(([k]) => h[k]).map(([, cat], idx) => ({
      filterCategory: cat,
      filterNo: h[FILTER_MAP[idx][0]],
      actionType: "X",
    }));
    const oilQty = parseMeter(h.oilQty);

    if (!dryRun) {
      await prisma.serviceRecord.create({
        data: {
          assetId: asset.id,
          serviceDate: date,
          meterType: asset.meterType,
          meterAtService: parseMeter(h.sm),
          nextServiceMeter: parseMeter(h.nsm),
          jobNo: h.jobNo || null,
          siteLocation: h.site || null,
          repairDetails: h.remarks || null,
          note: "Imported from Service record.xlsx",
          recordedById: user.id,
          oils: oilQty ? { create: [{ oilName: "Engine Oil", quantity: oilQty }] } : undefined,
          filters: filters.length ? { create: filters } : undefined,
        },
      });
    }
    created++;
  }

  console.log(`  matched=${matched} unmatched=${unmatched} skipped(no date)=${noDate} skipped(duplicate)=${dup}`);
  console.log(dryRun ? `  would import ${created} records` : `  imported ${created} records`);
  if (unmatchedSamples.length) console.log(`  sample unmatched vehicles: ${unmatchedSamples.join(" | ")}`);
  return { rows: records.length, matched, unmatched, noDate, dup, created, unmatchedSamples };
}

async function main() {
  const dir = process.env.SERVICE_RECORD_DIR || path.join(__dirname, "..", "..", "service-record");
  const dryRun = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
  await importServiceHistory({ dir, dryRun });
  process.exit(0);
}

// Run as a script (not when imported for verification).
if (process.argv[1] && /import_service_history\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
