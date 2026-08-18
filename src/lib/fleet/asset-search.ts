// One definition of "search for a machine", shared by every screen with a
// vehicle search box.
//
// The fuel issue log, meter readings and the service log each matched only
// Asset.code — the E&C number. 268 of the 711 machines carry a registration
// number that differs from their E&C number (LB-23 is ZB-2587, LD-06 is
// ZA-3116), so searching by the number painted on the vehicle returned nothing
// at all, even though the box invited exactly that. The fleet directory already
// searched the wider set; this makes the rest agree with it.
//
// Case is not folded here on purpose: SQLite's LIKE — which Prisma's `contains`
// compiles to — is already case-insensitive for ASCII, and upper-casing the
// term first would only mislead the next reader into thinking it mattered.

export interface AssetSearchClause {
  OR: (
    | { code: { contains: string } }
    | { regNo: { contains: string } }
    | { brand: { contains: string } }
    | { model: { contains: string } }
  )[];
}

// Fields a machine can be found by: its E&C number, the registration/vehicle
// number, and the make/model for looser lookups ("komatsu").
export function assetSearchClause(term: string): AssetSearchClause | null {
  const q = term.trim();
  if (!q) return null;
  return {
    OR: [
      { code: { contains: q } },
      { regNo: { contains: q } },
      { brand: { contains: q } },
      { model: { contains: q } },
    ],
  };
}

// True when the term would match this machine — the same rule as the query
// above, for filtering rows already in memory.
export function assetMatchesSearch(
  asset: { code: string; regNo?: string | null; brand?: string | null; model?: string | null },
  term: string,
): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [asset.code, asset.regNo, asset.brand, asset.model].some(
    (f) => !!f && f.toLowerCase().includes(q),
  );
}
