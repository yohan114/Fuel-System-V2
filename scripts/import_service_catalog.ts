// Imports the filter catalog + price book + vehicle links from the Service
// Record system's `vehicle_filter_data.js` dump, then rebuilds the
// cross-reference index. Filter prices/links are replaced; FilterCatalog is
// upserted by sourceId so manual cross-references survive a re-import.
//
// Run: DATABASE_URL="file:./data/app.db" \
//      SERVICE_RECORD_DIR=/home/user/service-record \
//      npx tsx scripts/import_service_catalog.ts
import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import { normalize, rebuildIndex } from "../src/lib/service/xref";

interface DumpFilter { id: number; cat?: string; oem?: string; hifi?: string; desc?: string; fleet?: string; crossRef?: string }
interface DumpPrice { id: number; code?: string; desc?: string; qty?: number; unit?: number; total?: number }
interface DumpLink { fid: number; ref?: string; ec?: string; vid?: number | null }

function loadDump(dir: string): { DB_FILTERS: DumpFilter[]; DB_PRICES: DumpPrice[]; DB_VF_LINKS: DumpLink[] } {
  const file = path.join(dir, "vehicle_filter_data.js");
  const code = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const factory = new Function(code + "\n; return { DB_FILTERS, DB_VF_LINKS, DB_PRICES };");
  return factory();
}

const toCents = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
};

async function main() {
  const dir = process.env.SERVICE_RECORD_DIR || path.join(__dirname, "..", "..", "service-record");
  console.log("Loading catalog from", dir);
  const D = loadDump(dir);
  console.log(`  filters=${D.DB_FILTERS.length} prices=${D.DB_PRICES.length} links=${D.DB_VF_LINKS.length}`);

  // 1) Filter catalog (upsert by sourceId — keeps manual cross-refs).
  console.log("Upserting filter catalog…");
  for (const f of D.DB_FILTERS) {
    const data = {
      filterCategory: f.cat || null,
      oemPartNumber: f.oem || null,
      hifiPartNumber: f.hifi || null,
      description: f.desc || null,
      compatibleFleet: f.fleet || null,
      crossRefText: f.crossRef || null,
    };
    await prisma.filterCatalog.upsert({
      where: { sourceId: f.id },
      update: data,
      create: { sourceId: f.id, ...data },
    });
  }

  // 2) Filter price book (replace).
  console.log("Replacing filter price book…");
  await prisma.filterPrice.deleteMany({});
  const priceRows = D.DB_PRICES.filter((p) => p.code).map((p) => ({
    supplierCode: String(p.code),
    normalizedCode: normalize(p.code),
    description: p.desc || null,
    qty: Number(p.qty) || 1,
    unitPriceCents: toCents(p.unit),
    totalPriceCents: toCents(p.total),
  }));
  for (let i = 0; i < priceRows.length; i += 1000) {
    await prisma.filterPrice.createMany({ data: priceRows.slice(i, i + 1000) });
  }

  // 3) Vehicle links (replace) — resolve sourceId → catalog id.
  console.log("Replacing vehicle links…");
  await prisma.filterVehicleLink.deleteMany({});
  const catalog = await prisma.filterCatalog.findMany({ select: { id: true, sourceId: true } });
  const bySource = new Map(catalog.filter((c) => c.sourceId != null).map((c) => [c.sourceId as number, c.id]));
  const linkRows = D.DB_VF_LINKS
    .map((l) => ({ catalogId: bySource.get(l.fid), ec: (l.ec || "").toString().trim().toUpperCase() }))
    .filter((l): l is { catalogId: string; ec: string } => !!l.catalogId && !!l.ec);
  for (let i = 0; i < linkRows.length; i += 1000) {
    await prisma.filterVehicleLink.createMany({ data: linkRows.slice(i, i + 1000) });
  }

  // 4) Rebuild the cross-reference index (auto rows; manual preserved).
  console.log("Rebuilding cross-reference index…");
  const idx = await rebuildIndex();

  console.log(`Done. catalog=${D.DB_FILTERS.length}, prices=${priceRows.length}, links=${linkRows.length}, indexed=${idx.indexed}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
