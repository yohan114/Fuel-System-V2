// Read-only reconciliation report: how well the filter catalog's vehicle links
// (by E&C code) line up with the live Asset fleet. This drives the "machines
// that use this filter" feature — describeFilter matches FilterVehicleLink.ec to
// Asset.code exactly (uppercased). The report flags codes that only match after
// normalization (e.g. "LB01" vs "LB-01") so data can be cleaned if needed.
// Run: DATABASE_URL="file:./data/app.db" npx tsx scripts/reconcile_fleet_catalog.ts
import { prisma } from "../src/lib/db";

const norm = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const [links, assets] = await Promise.all([
    prisma.filterVehicleLink.findMany({ select: { ec: true, catalogId: true } }),
    prisma.asset.findMany({ select: { code: true } }),
  ]);

  const assetExact = new Set(assets.map((a) => a.code.toUpperCase()));
  const assetNorm = new Map(assets.map((a) => [norm(a.code), a.code]));

  const catalogEcs = [...new Set(links.map((l) => l.ec.toUpperCase()).filter(Boolean))];
  const exact: string[] = [];
  const normOnly: string[] = [];
  const noMatch: string[] = [];
  for (const ec of catalogEcs) {
    if (assetExact.has(ec)) exact.push(ec);
    else if (assetNorm.has(norm(ec))) normOnly.push(ec);
    else noMatch.push(ec);
  }

  // Filters whose machines will resolve (≥1 link matching an asset exactly).
  const filtersWithMachine = new Set(
    links.filter((l) => assetExact.has(l.ec.toUpperCase())).map((l) => l.catalogId)
  );
  // Assets with no filter link at all.
  const linkedEcExact = new Set(links.map((l) => l.ec.toUpperCase()));
  const assetsNoLink = assets.filter((a) => !linkedEcExact.has(a.code.toUpperCase()));

  console.log("Fleet ↔ catalog reconciliation");
  console.log(`  live assets: ${assets.length}`);
  console.log(`  catalog vehicle links: ${links.length} (${catalogEcs.length} distinct E&C codes)`);
  console.log(`  E&C codes matching an asset exactly:        ${exact.length}`);
  console.log(`  E&C codes matching only after normalization: ${normOnly.length}`);
  console.log(`  E&C codes with no matching asset:            ${noMatch.length}`);
  console.log(`  filters whose "machines" will resolve:       ${filtersWithMachine.size}`);
  console.log(`  assets with no filter link:                  ${assetsNoLink.length}`);
  if (normOnly.length) console.log(`\n  normalization-only (cleanable) e.g.: ${normOnly.slice(0, 20).map((e) => `${e}→${assetNorm.get(norm(e))}`).join(", ")}`);
  if (noMatch.length) console.log(`\n  unmatched catalog codes e.g.: ${noMatch.slice(0, 20).join(", ")}`);
  if (assetsNoLink.length) console.log(`\n  assets without a filter link e.g.: ${assetsNoLink.slice(0, 20).map((a) => a.code).join(", ")}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
