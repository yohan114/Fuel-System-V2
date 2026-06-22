// Shared utilities for the oil/lubricant stock importer and runtime consumer
// classification. Ported from Oil Stock Book's `scripts/lib.js`, adapted to
// link issues against this system's canonical `Asset` and `Project` (UUID ids)
// instead of Oil Stock Book's parallel `fleet_assets` / `projects` tables.

/** Normalize an identifier/description for matching: uppercase, strip non-alphanumerics. */
export function normalize(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function round3(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

/** Convert an Excel serial date (1900 system) to ISO 'YYYY-MM-DD'. */
export function serialToISO(n: unknown): string | null {
  if (typeof n !== "number" || !isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const DATE_MIN = "2024-06-01";
const DATE_MAX = "2027-12-31";

/**
 * Tolerant date resolution. Returns { iso, bad }.
 * Blank cells silently inherit prevISO (common in these ledgers — the date is
 * written once per day). Only a present-but-invalid value is flagged `bad`.
 */
export function resolveDate(
  raw: unknown,
  prevISO: string | null,
): { iso: string; bad: boolean } {
  const blank =
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "");
  if (blank) return { iso: prevISO || "2025-06-01", bad: false };
  let iso: string | null = null;
  if (typeof raw === "number") iso = serialToISO(raw);
  else if (raw instanceof Date && !isNaN(raw.getTime()))
    iso = raw.toISOString().slice(0, 10);
  else if (typeof raw === "string") {
    const t = Date.parse(raw);
    if (!isNaN(t)) iso = new Date(t).toISOString().slice(0, 10);
  }
  if (iso && iso > "2026-06-12") {
    iso = "2025" + iso.slice(4);
  }
  if (iso && iso >= DATE_MIN && iso <= DATE_MAX) return { iso, bad: false };
  return { iso: prevISO || iso || "2025-06-01", bad: true };
}

// ── Stock-book sheet → canonical product mapping ──────────────────────────────
export const SKIP_SHEETS = new Set([
  "Summery",
  "Chart1",
  "Sheet1",
  "Sheet2",
  "Sheet3",
]);

export interface ProductMeta {
  name: string;
  unit: string;
  category: string;
}

export const PRODUCT_MAP: Record<string, ProductMeta> = {
  "15W40(CI-04)Valvoline": { name: "15W40 (CI-04) Valvoline", unit: "L", category: "engine_oil" },
  "15W40(servo)": { name: "15W40 (CI-04) Servo", unit: "L", category: "engine_oil" },
  "15W40(Delogold)": { name: "15W40 (CI-04) Delogold", unit: "L", category: "engine_oil" },
  "DS-10 Oil": { name: "DS-10", unit: "L", category: "engine_oil" },
  "20W-50": { name: "20W-50", unit: "L", category: "engine_oil" },
  "SAE-30": { name: "SAE-30", unit: "L", category: "engine_oil" },
  "HD-68 Hy-Oil Caltex": { name: "HD-68 Hy/Oil Caltex", unit: "L", category: "hydraulic" },
  "SERVO-68 HY-OIL": { name: "SERVO-68 Hy/Oil", unit: "L", category: "hydraulic" },
  "HD-46 Hy-Oil-Caltex": { name: "HD-46 Hy/Oil Caltex", unit: "L", category: "hydraulic" },
  "HD-46 Hy Oil SERVO": { name: "HD-46 Hy/Oil Servo", unit: "L", category: "hydraulic" },
  "Power Oil-1888": { name: "Power Oil-1888", unit: "L", category: "hydraulic" },
  "MP-90 Gear Oil": { name: "MP-90 Gear Oil", unit: "L", category: "gear_oil" },
  "80W90 (Caltex)": { name: "80W90 Gear Oil Caltex", unit: "L", category: "gear_oil" },
  "80W90 G-Oil (Servo)": { name: "80W90 Gear Oil Servo", unit: "L", category: "gear_oil" },
  "MP-140 G-Oil": { name: "MP-140 Gear Oil", unit: "L", category: "gear_oil" },
  Grease: { name: "Grease", unit: "kg", category: "grease" },
  "K-Oil": { name: "Karosine Oil", unit: "L", category: "fuel" },
  PETROL: { name: "Petrol", unit: "L", category: "fuel" },
  "HUB GREASE": { name: "Hub Grease", unit: "kg", category: "grease" },
  "cotten waste": { name: "Cotton Waste", unit: "kg", category: "other" },
};

// ── Projects / sites (canonical + normalized match patterns) ──────────────────
export interface ProjectDef {
  name: string;
  location: string;
  patterns: string[];
}

export const PROJECTS: ProjectDef[] = [
  { name: "CEP-03 Project", location: "", patterns: ["CEP"] },
  { name: "Ruwanwella Water Project", location: "Ruwanwella", patterns: ["RUWANWELLA"] },
  { name: "Marawila Road Project", location: "Marawila", patterns: ["MARAWILA"] },
  { name: "Batticaloa Project", location: "Batticaloa", patterns: ["BATTICOLOA", "BATTICALOA", "BATTIC"] },
  { name: "Muthur Plant", location: "Muthur", patterns: ["MUTHUR"] },
  { name: "Asphalt Plant", location: "", patterns: ["ASPHALT"] },
  { name: "Iginimitiya Project", location: "Iginimitiya", patterns: ["IGINIMITIYA", "IGINI"] },
  { name: "Port City", location: "Colombo", patterns: ["PORTCITY"] },
  { name: "Kilinochchi Project", location: "Kilinochchi", patterns: ["KILINOCHCHI", "KILINOCH"] },
];

// Internal / workshop consumers (normalized substring match).
const INTERNAL_PATTERNS = [
  "SERVICE",
  "LATHE",
  "WORKSHOP",
  "WHEREHOUSE",
  "LOCALPURCH",
  "PILEDRIVER",
];

// Receipt / opening detection.
const OPENING_RE = /^(BF|BFBALANCE|BALANCE|BROUGHTFORWARD|BROUGHT|OPENING|OPENINGBALANCE)$/;
const RECEIPT_RE = /(MAINSTORE|EXCESSRECEIVED|LOCALPURCH|RECEIVE|RECEIVED)/;

export type MovementKind = "RECEIPT" | "ISSUE" | "OPENING" | "ADJUSTMENT";
export type ConsumerType = "ASSET" | "PROJECT" | "INTERNAL" | "UNKNOWN";

/** Decide transaction kind from description + numeric columns. */
export function classifyKind(
  desc: string | null,
  received: number,
  issued: number,
): MovementKind {
  const n = normalize(desc);
  const hasR = received > 0;
  const hasI = issued > 0;
  if (OPENING_RE.test(n)) return "OPENING";
  if (hasR && !hasI) return "RECEIPT";
  if (hasI) return "ISSUE";
  if (RECEIPT_RE.test(n)) return "RECEIPT";
  return hasR ? "RECEIPT" : "ISSUE";
}

export interface ClassifyContext {
  /** normalize(Asset.code) → Asset.id */
  ecMap: Map<string, string>;
  /** normalize(Asset.regNo) → Asset.id */
  regMap: Map<string, string>;
  /** Resolved project defs with this system's Project.id + match patterns. */
  projects: { id: string; patterns: string[] }[];
  /** normalize(rawText) → resolved alias. */
  aliasMap: Map<
    string,
    { targetType: ConsumerType; assetId: string | null; projectId: string | null; resolved: boolean }
  >;
}

export interface ConsumerResult {
  consumerType: ConsumerType;
  assetId: string | null;
  projectId: string | null;
}

/**
 * Classify an issue's consumer against in-memory lookups, in priority order:
 * resolved alias → direct/whole-string fleet match → per-token fleet match →
 * project pattern → internal pattern → unknown.
 */
export function classifyConsumer(
  desc: string | null,
  ctx: ClassifyContext,
): ConsumerResult {
  const n = normalize(desc);
  if (!n) return { consumerType: "UNKNOWN", assetId: null, projectId: null };

  // 1. Learned/resolved alias wins.
  const al = ctx.aliasMap.get(n);
  if (al && al.resolved) {
    return { consumerType: al.targetType, assetId: al.assetId, projectId: al.projectId };
  }

  // 2. Direct fleet match (whole string), then per-token.
  if (ctx.ecMap.has(n)) return { consumerType: "ASSET", assetId: ctx.ecMap.get(n)!, projectId: null };
  if (ctx.regMap.has(n)) return { consumerType: "ASSET", assetId: ctx.regMap.get(n)!, projectId: null };
  for (const tok of String(desc ?? "").split(/[^A-Za-z0-9]+/)) {
    const tn = normalize(tok);
    if (tn.length < 4) continue;
    if (ctx.ecMap.has(tn)) return { consumerType: "ASSET", assetId: ctx.ecMap.get(tn)!, projectId: null };
    if (ctx.regMap.has(tn)) return { consumerType: "ASSET", assetId: ctx.regMap.get(tn)!, projectId: null };
  }

  // 3. Project / site.
  for (const p of ctx.projects) {
    if (p.patterns.some((pat) => n.includes(pat))) {
      return { consumerType: "PROJECT", assetId: null, projectId: p.id };
    }
  }

  // 4. Internal / workshop.
  if (INTERNAL_PATTERNS.some((pat) => n.includes(pat))) {
    return { consumerType: "INTERNAL", assetId: null, projectId: null };
  }

  return { consumerType: "UNKNOWN", assetId: null, projectId: null };
}

export { OPENING_RE };
