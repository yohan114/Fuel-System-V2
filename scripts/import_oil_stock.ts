/**
 * Oil Stock Book importer — merges the standalone Oil Stock Book into Fuel
 * System V2. Unlike the original (which kept its own fleet/projects), this
 * links every oil issue to THIS system's canonical `Asset` and `Project`, so
 * oil consumption lands on the same machines we already track fuel & service
 * for.
 *
 * Two source modes (the "migrate live, reconcile to Excel" strategy):
 *
 *   # 1. Fresh seed from the source stock book (idempotent — importHash dedup)
 *   npx tsx scripts/import_oil_stock.ts [stockbook.xlsx]
 *   npx tsx scripts/import_oil_stock.ts --fresh        # wipe inventory first
 *
 *   # 2. Migrate a running Oil Stock Book database, then reconcile to the book
 *   npx tsx scripts/import_oil_stock.ts --from-db /path/to/oilbook.db
 *
 * In --from-db mode the live database is the source of truth (it already holds
 * the Excel-seeded rows plus any manual entries, batteries, requisitions and
 * stock-takes); the Excel files are then used only to CROSS-CHECK balances
 * against the official "Summery" snapshot — never re-inserted, so nothing is
 * double-counted.
 *
 * Requires DATABASE_URL (this system's SQLite db). Run AFTER the fleet/projects
 * have been seeded (`prisma db seed`), since consumer linking resolves against
 * existing assets & projects.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import Database from "better-sqlite3";
import * as XLSX from "xlsx";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import {
  normalize,
  round3,
  resolveDate,
  classifyConsumer,
  PRODUCT_MAP,
  SKIP_SHEETS,
  PROJECTS,
  type ClassifyContext,
  type ConsumerType,
  type MovementKind,
} from "../src/lib/stock/classify";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./data/app.db",
});
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const FRESH = args.includes("--fresh");
const fromDbIdx = args.indexOf("--from-db");
const FROM_DB = fromDbIdx >= 0 ? args[fromDbIdx + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && (fromDbIdx < 0 || i !== fromDbIdx + 1));
// Only the stock book is needed: the fleet/projects come from THIS system's
// canonical tables (machinelist.xlsx is no longer imported — we link to Asset).
const STOCKBOOK = files[0] || path.join(process.cwd(), "data", "source", "stockbook.xlsx");

// Imported rows get year-2000 createdAt timestamps, strictly increasing in
// physical order, so the ledger recompute reproduces the book row-for-row and
// every imported row sorts before any in-app entry on the same date.
const CREATED_BASE = Date.UTC(2000, 0, 1);
let seq = 0;
const nextCreatedAt = () => new Date(CREATED_BASE + seq++ * 1000);

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ── V2 lookups: link oil consumption to canonical assets & projects ───────────
async function buildAssetMaps() {
  const ecMap = new Map<string, string>();
  const regMap = new Map<string, string>();
  const assets = await prisma.asset.findMany({ select: { id: true, code: true, regNo: true } });
  for (const a of assets) {
    const ec = normalize(a.code);
    if (ec && !ecMap.has(ec)) ecMap.set(ec, a.id);
    const reg = a.regNo ? normalize(a.regNo) : "";
    if (reg && !regMap.has(reg)) regMap.set(reg, a.id);
  }
  return { ecMap, regMap };
}

// Resolve each Oil Stock Book project definition to a canonical V2 Project,
// matching by normalized name or by pattern against existing names/codes, and
// creating any that don't exist yet. Returns the classify list + name→id map.
async function resolveProjects() {
  const existing = await prisma.project.findMany({ select: { id: true, name: true, code: true } });
  const byNorm = new Map(existing.map((p) => [normalize(p.name), p.id]));
  const projects: { id: string; patterns: string[] }[] = [];
  const nameToId = new Map<string, string>();

  for (const def of PROJECTS) {
    let id = byNorm.get(normalize(def.name));
    if (!id) {
      const hit = existing.find((p) =>
        def.patterns.some((pat) => normalize(p.name).includes(pat) || normalize(p.code).includes(pat)),
      );
      id = hit?.id;
    }
    if (!id) {
      // Derive a unique short code from the first pattern.
      let code = def.patterns[0].slice(0, 12);
      let n = 1;
      while (existing.some((p) => p.code === code)) code = `${def.patterns[0].slice(0, 10)}${++n}`;
      const created = await prisma.project.create({
        data: { name: def.name, code },
      });
      id = created.id;
      existing.push({ id, name: def.name, code });
      console.log(`  + created project "${def.name}" (${code})`);
    }
    projects.push({ id, patterns: def.patterns });
    nameToId.set(normalize(def.name), id);
  }
  return { projects, nameToId };
}

async function buildContext(
  projects: { id: string; patterns: string[] }[],
): Promise<ClassifyContext> {
  const { ecMap, regMap } = await buildAssetMaps();
  const aliasMap = new Map<
    string,
    { targetType: ConsumerType; assetId: string | null; projectId: string | null; resolved: boolean }
  >();
  for (const a of await prisma.consumerAlias.findMany({ where: { resolved: true } })) {
    aliasMap.set(a.rawNorm, {
      targetType: (a.targetType as ConsumerType) || "UNKNOWN",
      assetId: a.assetId,
      projectId: a.projectId,
      resolved: true,
    });
  }
  return { ecMap, regMap, projects, aliasMap };
}

// ── Products ──────────────────────────────────────────────────────────────────
async function upsertProduct(meta: { name: string; unit: string; category: string }, sheetName: string, order: number) {
  return prisma.product.upsert({
    where: { name: meta.name },
    update: { unit: meta.unit, category: meta.category, sheetName, sortOrder: order },
    create: { name: meta.name, unit: meta.unit, category: meta.category, sheetName, sortOrder: order },
  });
}

// ── Excel transaction import (reconciles to the book's Balance column) ─────────
function findDataStart(rows: any[][]): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((c) => typeof c === "string" && /^description$/i.test(c.trim()))) return i + 1;
  }
  return 5;
}
function firstValidISO(rows: any[][], start: number): string {
  for (let i = start; i < rows.length; i++) {
    const { iso, bad } = resolveDate(rows[i][0], null);
    if (!bad) return iso;
  }
  return "2025-06-01";
}

interface ImportStats {
  rows: number; receipts: number; issues: number; openings: number; adjustments: number;
  badDates: number; reconciled: number;
  ASSET: number; PROJECT: number; INTERNAL: number; UNKNOWN: number;
}

async function importExcelTransactions(stockWb: XLSX.WorkBook, ctx: ClassifyContext): Promise<ImportStats> {
  const stats: ImportStats = {
    rows: 0, receipts: 0, issues: 0, openings: 0, adjustments: 0, badDates: 0, reconciled: 0,
    ASSET: 0, PROJECT: 0, INTERNAL: 0, UNKNOWN: 0,
  };

  let order = 0;
  for (const sheet of stockWb.SheetNames) {
    if (SKIP_SHEETS.has(sheet) || !PRODUCT_MAP[sheet]) continue;
    const product = await upsertProduct(PRODUCT_MAP[sheet], sheet, order++);

    const rows = XLSX.utils.sheet_to_json<any[]>(stockWb.Sheets[sheet], { header: 1, raw: true, blankrows: false });
    const start = findDataStart(rows);
    let prevISO = firstValidISO(rows, start);
    let running = 0;
    let firstMovement = true;

    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const desc = str(r[3]);
      const received = num(r[4]);
      const issued = num(r[5]);
      const balRaw = r[6];
      const hasBal = typeof balRaw === "number";
      if (desc && /^(date|description)$/i.test(desc)) continue;
      if (desc === null && received === 0 && issued === 0 && !hasBal) continue;

      const { iso, bad } = resolveDate(r[0], prevISO);
      prevISO = iso;

      // Decide movement; reconcile against the book's Balance column when present.
      let kind: MovementKind;
      let qtyR = 0;
      let qtyI = 0;
      if (received === 0 && issued === 0) {
        if (!hasBal) continue;
        const delta = round3(balRaw - running);
        if (Math.abs(delta) <= 0.01) continue; // trailing balance-carry row → skip
        kind = firstMovement ? "OPENING" : "ADJUSTMENT";
        if (delta >= 0) qtyR = delta; else qtyI = -delta;
      } else if (issued > 0) {
        kind = "ISSUE"; qtyI = round3(issued); qtyR = round3(received);
      } else {
        kind = "RECEIPT"; qtyR = round3(received);
      }
      if (kind === "RECEIPT" && /^(BF|BFBALANCE|BALANCE|OPENING)/.test(normalize(desc)) && firstMovement) kind = "OPENING";

      // Fold any residual so the stored movements reproduce the book exactly.
      let reconciled = false;
      if (hasBal) {
        const projected = round3(running + qtyR - qtyI);
        const residual = round3(balRaw - projected);
        if (Math.abs(residual) > 0.01) {
          if (residual >= 0) qtyR = round3(qtyR + residual); else qtyI = round3(qtyI - residual);
          reconciled = true;
        }
      }
      running = round3(running + qtyR - qtyI);

      let consumerType: ConsumerType | null = null;
      let assetId: string | null = null;
      let projectId: string | null = null;
      if (kind === "ISSUE") {
        const c = classifyConsumer(desc, ctx);
        consumerType = c.consumerType; assetId = c.assetId; projectId = c.projectId;
        stats[c.consumerType]++;
        if (c.consumerType === "UNKNOWN" && desc) await bumpAlias(desc);
      }

      let remark = str(r[7]);
      if (bad) remark = (remark ? remark + " " : "") + `[BAD_DATE:${r[0]}]`;
      if (reconciled) remark = (remark ? remark + " " : "") + "[balance reconciled]";

      const importHash = crypto.createHash("sha1")
        .update(`${sheet}|${i}|${iso}|${desc || ""}|${qtyR}|${qtyI}`)
        .digest("hex");

      // Idempotent: skip a row we've already imported (re-runs never duplicate).
      const exists = await prisma.stockMovement.findUnique({ where: { importHash }, select: { id: true } });
      if (!exists) {
        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            txnDate: new Date(`${iso}T00:00:00.000Z`),
            kind,
            qtyReceived: qtyR,
            qtyIssued: qtyI,
            balanceAfter: running,
            consumerType,
            assetId,
            projectId,
            description: desc,
            mrNo: str(r[1]),
            mtnNo: str(r[2]),
            remark,
            importHash,
            source: "import",
            createdAt: nextCreatedAt(),
          },
        });
      }

      firstMovement = false;
      stats.rows++;
      stats[kind === "OPENING" ? "openings" : kind === "ADJUSTMENT" ? "adjustments" : kind === "RECEIPT" ? "receipts" : "issues"]++;
      if (bad) stats.badDates++;
      if (reconciled) stats.reconciled++;
    }
  }
  return stats;
}

// Record/​increment an unresolved consumer alias for the Mapping screen.
async function bumpAlias(rawText: string) {
  const rawNorm = normalize(rawText);
  await prisma.consumerAlias.upsert({
    where: { rawNorm },
    update: { hitCount: { increment: 1 } },
    create: { rawText, rawNorm, hitCount: 1 },
  });
}

// ── Default reorder levels (≈ one month of recent issues) ─────────────────────
async function setDefaultReorderLevels() {
  const products = await prisma.product.findMany({ select: { id: true, reorderLevel: true } });
  const since = new Date();
  since.setDate(since.getDate() - 90);
  for (const p of products) {
    if (p.reorderLevel != null) continue; // keep any level already set (e.g. migrated)
    const agg = await prisma.stockMovement.aggregate({
      _sum: { qtyIssued: true },
      where: { productId: p.id, voided: false, kind: "ISSUE", txnDate: { gte: since } },
    });
    const issued = agg._sum.qtyIssued ?? 0;
    const level = round3(issued / 3);
    await prisma.product.update({ where: { id: p.id }, data: { reorderLevel: level > 0 ? level : 10 } });
  }
}

// ── Recompute one product's running balance (matches src/lib/stock/ledger.ts) ──
async function recomputeProduct(productId: string): Promise<number> {
  const rows = await prisma.stockMovement.findMany({
    where: { productId, voided: false },
    orderBy: [{ txnDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, qtyReceived: true, qtyIssued: true, balanceAfter: true },
  });
  let running = 0;
  for (const r of rows) {
    running = round3(running + r.qtyReceived - r.qtyIssued);
    if (running !== r.balanceAfter) {
      await prisma.stockMovement.update({ where: { id: r.id }, data: { balanceAfter: running } });
    }
  }
  return running;
}

async function recomputeAll() {
  for (const p of await prisma.product.findMany({ select: { id: true } })) await recomputeProduct(p.id);
}

// ── Summery cross-check (computed balance vs the spreadsheet snapshot) ─────────
async function summeryCrossCheck(stockWb: XLSX.WorkBook) {
  const ws = stockWb.Sheets["Summery"];
  if (!ws) return [] as { item: string; summery: number; computed: number; diff: number }[];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true, blankrows: false });
  let itemCol = -1, qtyCol = -1, hdr = -1;
  for (let i = 0; i < rows.length && hdr < 0; i++) {
    rows[i].forEach((v, c) => {
      const t = String(v ?? "").trim().toLowerCase();
      if (t === "item") itemCol = c;
      if (t === "qty" || t === "quantity") qtyCol = c;
    });
    if (itemCol >= 0 && qtyCol >= 0) hdr = i;
  }
  if (hdr < 0) return [];
  const products = (await prisma.product.findMany({ select: { id: true, name: true } }))
    .map((p) => ({ ...p, norm: normalize(p.name) }));
  const diffs: { item: string; summery: number; computed: number; diff: number }[] = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const item = str(rows[i][itemCol]);
    const qty = rows[i][qtyCol];
    if (!item || typeof qty !== "number") continue;
    const itemNorm = normalize(item);
    const match = products.find((p) => p.norm === itemNorm)
      || products.find((p) => itemNorm.includes(p.norm) || p.norm.includes(itemNorm));
    if (!match) continue;
    const last = await prisma.stockMovement.findFirst({
      where: { productId: match.id, voided: false },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { balanceAfter: true },
    });
    const computed = last?.balanceAfter ?? 0;
    diffs.push({ item: match.name, summery: qty, computed, diff: round3(computed - qty) });
  }
  return diffs;
}

// ── Live Oil Stock Book DB migration (--from-db) ───────────────────────────────
// Copies products, the full transaction ledger, sites, stock-takes,
// requisitions, resolved aliases and the battery register from a running Oil
// Stock Book SQLite file, remapping its integer ids to V2 UUIDs and relinking
// consumers to this system's canonical fleet & projects.
async function migrateLiveDb(dbPath: string, ctx: ClassifyContext, nameToId: Map<string, string>) {
  if (!fs.existsSync(dbPath)) { console.error(`Missing --from-db file: ${dbPath}`); process.exit(1); }
  const src = new Database(dbPath, { readonly: true });
  console.log(`\nMigrating live Oil Stock Book database: ${dbPath}`);

  // Oil asset/project id → identifying keys, for relinking to V2.
  const oilAsset = new Map<number, { ec: string | null; reg: string | null }>();
  for (const a of src.prepare("SELECT id, ec_code, registration FROM fleet_assets").all() as any[]) {
    oilAsset.set(a.id, { ec: a.ec_code, reg: a.registration });
  }
  const oilProject = new Map<number, string>(); // id → normalized name
  for (const p of src.prepare("SELECT id, name FROM projects").all() as any[]) {
    oilProject.set(p.id, normalize(p.name));
  }
  const relinkAsset = (oilId: number | null): string | null => {
    if (oilId == null) return null;
    const k = oilAsset.get(oilId);
    if (!k) return null;
    return (k.ec && ctx.ecMap.get(normalize(k.ec))) || (k.reg && ctx.regMap.get(normalize(k.reg))) || null;
  };
  const relinkProject = (oilId: number | null): string | null => {
    if (oilId == null) return null;
    const norm = oilProject.get(oilId);
    return (norm && nameToId.get(norm)) || null;
  };

  // Products (by name; carry reorder level, price → cents, category, order).
  const oilProductIdToV2 = new Map<number, string>();
  for (const p of src.prepare("SELECT * FROM products").all() as any[]) {
    const created = await prisma.product.upsert({
      where: { name: p.name },
      update: {
        unit: p.unit || "L",
        category: p.category,
        sheetName: p.sheet_name,
        sortOrder: p.sort_order ?? 0,
        active: !!p.active,
        reorderLevel: p.reorder_level ?? undefined,
        unitPriceCents: p.unit_price != null ? Math.round(p.unit_price * 100) : undefined,
      },
      create: {
        name: p.name,
        unit: p.unit || "L",
        category: p.category,
        sheetName: p.sheet_name,
        sortOrder: p.sort_order ?? 0,
        active: !!p.active,
        reorderLevel: p.reorder_level ?? null,
        unitPriceCents: p.unit_price != null ? Math.round(p.unit_price * 100) : null,
      },
    });
    oilProductIdToV2.set(p.id, created.id);
  }

  // Sites (under their project).
  const oilSiteToV2 = new Map<number, string>();
  for (const s of src.prepare("SELECT * FROM sites").all() as any[]) {
    const projectId = relinkProject(s.project_id);
    if (!projectId) continue;
    const created = await prisma.site.upsert({
      where: { projectId_nameNorm: { projectId, nameNorm: s.name_norm } },
      update: { name: s.name, active: !!s.active },
      create: { projectId, name: s.name, nameNorm: s.name_norm, active: !!s.active },
    });
    oilSiteToV2.set(s.id, created.id);
  }

  // Transactions (the full ledger). source 'import' rows keep that tag; manual
  // ones become 'manual'. importHash carried over so a later Excel re-run dedups.
  const oilTxnToV2 = new Map<number, string>();
  let txnN = 0;
  for (const t of src.prepare("SELECT * FROM transactions ORDER BY product_id, txn_date, id").all() as any[]) {
    const productId = oilProductIdToV2.get(t.product_id);
    if (!productId) continue;
    let assetId = relinkAsset(t.asset_id);
    let projectId = relinkProject(t.project_id);
    let consumerType = (t.consumer_type ? String(t.consumer_type).toUpperCase() : null) as ConsumerType | null;
    // Fall back to text classification when the live link didn't resolve.
    if (t.kind === "issue" && !assetId && !projectId) {
      const c = classifyConsumer(t.description, ctx);
      assetId = c.assetId; projectId = c.projectId; consumerType = c.consumerType;
      if (c.consumerType === "UNKNOWN" && t.description) await bumpAlias(t.description);
    }
    const importHash = t.import_hash || `live:${dbPath}:${t.id}`;
    const exists = await prisma.stockMovement.findUnique({ where: { importHash }, select: { id: true } });
    if (exists) { oilTxnToV2.set(t.id, exists.id); continue; }
    const created = await prisma.stockMovement.create({
      data: {
        productId,
        txnDate: new Date(`${String(t.txn_date).slice(0, 10)}T00:00:00.000Z`),
        kind: String(t.kind).toUpperCase() as MovementKind,
        qtyReceived: t.qty_received ?? 0,
        qtyIssued: t.qty_issued ?? 0,
        balanceAfter: t.balance_after ?? 0,
        consumerType,
        assetId,
        projectId,
        siteId: t.site_id != null ? oilSiteToV2.get(t.site_id) ?? null : null,
        description: t.description,
        mrNo: t.mr_no,
        mtnNo: t.mtn_no,
        remark: t.remark,
        voided: !!t.voided,
        source: t.source === "import" ? "import" : "manual",
        importHash,
        createdAt: nextCreatedAt(),
      },
    });
    oilTxnToV2.set(t.id, created.id);
    txnN++;
  }

  // Resolved consumer aliases (the learned mapping).
  let aliasN = 0;
  for (const a of src.prepare("SELECT * FROM aliases").all() as any[]) {
    await prisma.consumerAlias.upsert({
      where: { rawNorm: a.raw_norm },
      update: {
        targetType: a.target_type ? String(a.target_type).toUpperCase() : null,
        assetId: relinkAsset(a.asset_id),
        projectId: relinkProject(a.project_id),
        resolved: !!a.resolved,
        hitCount: a.hit_count ?? 1,
      },
      create: {
        rawText: a.raw_text,
        rawNorm: a.raw_norm,
        targetType: a.target_type ? String(a.target_type).toUpperCase() : null,
        assetId: relinkAsset(a.asset_id),
        projectId: relinkProject(a.project_id),
        resolved: !!a.resolved,
        hitCount: a.hit_count ?? 1,
      },
    });
    aliasN++;
  }

  // Stock takes.
  let countN = 0;
  for (const c of src.prepare("SELECT * FROM stock_counts").all() as any[]) {
    const productId = oilProductIdToV2.get(c.product_id);
    if (!productId) continue;
    await prisma.stockCount.upsert({
      where: { productId_period: { productId, period: c.period } },
      update: { bookQty: c.book_qty, countedQty: c.counted_qty, variance: c.variance, adjusted: !!c.adjusted, note: c.note },
      create: { productId, period: c.period, bookQty: c.book_qty, countedQty: c.counted_qty, variance: c.variance, adjusted: !!c.adjusted, note: c.note },
    });
    countN++;
  }

  // Requisitions (link to the migrated issue movement when present).
  let reqN = 0;
  for (const r of src.prepare("SELECT * FROM requisitions").all() as any[]) {
    const productId = oilProductIdToV2.get(r.product_id);
    if (!productId) continue;
    await prisma.requisition.create({
      data: {
        productId,
        projectId: relinkProject(r.project_id),
        siteId: r.site_id != null ? oilSiteToV2.get(r.site_id) ?? null : null,
        qtyRequested: r.qty_requested,
        qtySent: r.qty_sent,
        qtyReceived: r.qty_received,
        status: String(r.status || "pending").toUpperCase(),
        txnId: r.txn_id != null ? oilTxnToV2.get(r.txn_id) ?? null : null,
        note: r.note,
        rejectReason: r.reject_reason,
        discrepancy: !!r.discrepancy,
        sentAt: r.sent_at ? new Date(r.sent_at) : null,
        receivedAt: r.received_at ? new Date(r.received_at) : null,
      },
    });
    reqN++;
  }

  // Battery register + append-only events. Photos move from disk → inline Bytes.
  const uploadsDir = path.join(path.dirname(dbPath), "uploads");
  const readPhoto = (rel: string | null): Uint8Array<ArrayBuffer> | null => {
    if (!rel) return null;
    const candidates = [rel, path.join(uploadsDir, path.basename(rel)), path.join(path.dirname(dbPath), rel)];
    for (const f of candidates) {
      try {
        if (fs.existsSync(f)) {
          const buf = fs.readFileSync(f);
          const out = new Uint8Array(buf.byteLength); // fresh ArrayBuffer-backed
          out.set(buf);
          return out;
        }
      } catch { /* ignore */ }
    }
    return null;
  };
  const mimeOf = (p: string | null) => {
    const ext = (p || "").toLowerCase().split(".").pop();
    return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  };
  let batN = 0;
  for (const b of src.prepare("SELECT * FROM batteries").all() as any[]) {
    const photo = readPhoto(b.photo_path);
    if (!photo) { console.warn(`  ! battery ${b.serial_no}: photo not found (${b.photo_path}); skipped`); continue; }
    await prisma.battery.upsert({
      where: { serialNoNorm: b.serial_no_norm },
      update: { vehicleNo: b.vehicle_no, vehicleNoNorm: b.vehicle_no_norm, note: b.note, photoData: photo, photoMime: mimeOf(b.photo_path) },
      create: {
        vehicleNo: b.vehicle_no, vehicleNoNorm: b.vehicle_no_norm,
        serialNo: b.serial_no, serialNoNorm: b.serial_no_norm,
        note: b.note, photoData: photo, photoMime: mimeOf(b.photo_path),
      },
    });
    batN++;
  }
  let evtN = 0;
  for (const e of src.prepare("SELECT * FROM battery_events ORDER BY id").all() as any[]) {
    await prisma.batteryEvent.create({
      data: {
        action: String(e.action || "add").toUpperCase(),
        serialNo: e.serial_no, serialNoNorm: e.serial_no_norm,
        vehicleNo: e.vehicle_no, fromVehicleNo: e.from_vehicle_no,
        reason: e.reason, photoData: readPhoto(e.photo_path), photoMime: mimeOf(e.photo_path),
        createdAt: e.created_at ? new Date(e.created_at) : new Date(),
      },
    });
    evtN++;
  }

  src.close();
  console.log(`  migrated: ${oilProductIdToV2.size} products, ${txnN} transactions, ${oilSiteToV2.size} sites, ${aliasN} aliases, ${countN} stock-takes, ${reqN} requisitions, ${batN} batteries, ${evtN} battery events`);
}

// ── Run ───────────────────────────────────────────────────────────────────────
async function resetInventory() {
  // Wipe inventory only — never the shared fleet/projects/users.
  await prisma.requisition.deleteMany();
  await prisma.batteryEvent.deleteMany();
  await prisma.battery.deleteMany();
  await prisma.stockCount.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.consumerAlias.deleteMany();
  await prisma.product.deleteMany();
  await prisma.site.deleteMany();
  console.log("  (--fresh: wiped existing inventory data)");
}

async function main() {
  const assetCount = await prisma.asset.count();
  if (assetCount === 0) {
    console.warn("⚠  No assets found — run `prisma db seed` first so oil issues can link to the fleet.\n");
  }

  if (FRESH) await resetInventory();

  const { projects, nameToId } = await resolveProjects();
  const ctx = await buildContext(projects);

  let excelStats: ImportStats | null = null;
  if (FROM_DB) {
    await migrateLiveDb(FROM_DB, ctx, nameToId);
  } else {
    if (!fs.existsSync(STOCKBOOK)) { console.error(`Missing source file: ${STOCKBOOK}`); process.exit(1); }
    console.log(`Importing from Excel\n  stock book : ${STOCKBOOK}\n`);
    const stockWb = XLSX.readFile(STOCKBOOK);
    excelStats = await importExcelTransactions(stockWb, ctx);
  }

  await recomputeAll();
  await setDefaultReorderLevels();

  // Reconcile to the book (cross-check computed balances vs the Summery sheet).
  let diffs: { item: string; summery: number; computed: number; diff: number }[] = [];
  if (fs.existsSync(STOCKBOOK)) diffs = await summeryCrossCheck(XLSX.readFile(STOCKBOOK));

  const unresolved = await prisma.consumerAlias.count({ where: { resolved: false } });
  const productN = await prisma.product.count();

  console.log("\n── Import summary ─────────────────────────────");
  console.log(`  Products        : ${productN}`);
  if (excelStats) {
    const s = excelStats;
    console.log(`  Transactions    : ${s.rows}  (receipts ${s.receipts}, issues ${s.issues}, openings ${s.openings}, adjustments ${s.adjustments})`);
    console.log(`  Issue linkage   : asset ${s.ASSET}, project ${s.PROJECT}, internal ${s.INTERNAL}, unknown ${s.UNKNOWN}`);
    console.log(`  Bad dates fixed : ${s.badDates}  |  rows reconciled to book balance : ${s.reconciled}`);
  }
  console.log(`  Unresolved aliases (need mapping) : ${unresolved}`);
  if (diffs.length) {
    console.log("\n── Summery cross-check (computed vs spreadsheet) ──");
    for (const d of diffs) {
      const flag = Math.abs(d.diff) > 0.01 ? `  <-- diff ${d.diff}` : "";
      console.log(`  ${d.item.padEnd(26)} computed ${String(d.computed).padStart(9)} | summery ${String(d.summery).padStart(9)}${flag}`);
    }
  }
  console.log("\nDone.");
}

main()
  .catch((e) => { console.error("Oil stock import failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
