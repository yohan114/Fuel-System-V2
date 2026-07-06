import { prisma } from "../db";

// The recommended filter list for a vehicle — the filters known to fit it, from
// the AssetFilter mapping (imported from the service-record system's
// vehicle↔filter links), joined to the filter master for its part numbers,
// price and equivalents. This is the "HEX-21 filter list" a fitter wants before
// a service.

export interface VehicleFilterRow {
  filterId: string;
  category: string | null;
  hifiPartNo: string | null;
  oemPartNo: string | null;
  description: string | null;
  priceCents: number | null;
  crossRefs: string[]; // equivalent part numbers
  timesUsed: number; // times this filter appears on the vehicle's own services
}

export async function getVehicleFilters(assetId: string): Promise<VehicleFilterRow[]> {
  const links = await prisma.assetFilter.findMany({
    where: { assetId },
    include: { filter: { include: { crossRefs: true } } },
  });

  // How often each filter (by part number) was actually fitted on this vehicle.
  const usedItems = await prisma.serviceItem.findMany({
    where: { kind: "FILTER", serviceRecord: { assetId } },
    select: { partNo: true },
  });
  const usedByPN = new Map<string, number>();
  for (const it of usedItems) {
    const k = (it.partNo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (k) usedByPN.set(k, (usedByPN.get(k) ?? 0) + 1);
  }
  const pnKey = (s: string | null) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Dedupe by filter, keep the priced/most-complete row.
  const byId = new Map<string, VehicleFilterRow>();
  for (const l of links) {
    const f = l.filter;
    if (byId.has(f.id)) continue;
    const used = usedByPN.get(pnKey(f.hifiPartNo)) ?? usedByPN.get(pnKey(f.oemPartNo)) ?? 0;
    byId.set(f.id, {
      filterId: f.id,
      category: f.category,
      hifiPartNo: f.hifiPartNo,
      oemPartNo: f.oemPartNo,
      description: f.description,
      priceCents: f.priceCents,
      crossRefs: [...new Set(f.crossRefs.map((x) => x.partNumber).filter(Boolean))].slice(0, 6),
      timesUsed: used,
    });
  }

  return [...byId.values()].sort(
    (a, b) => (a.category || "~").localeCompare(b.category || "~") || (a.hifiPartNo || "").localeCompare(b.hifiPartNo || ""),
  );
}
