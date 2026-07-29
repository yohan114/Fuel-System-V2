import { prisma } from "../db";
import { normKey } from "./dedupe";

// Resolving "what vehicle did the operator mean" from free text.
//
// Every fuel/reading entry point used to match the typed value against id, code
// and regNo *exactly*, then silently create a new "Quick Added" asset when
// nothing matched. Typing "ZA0050" or "za-0050" for a vehicle registered
// "ZA-0050" therefore produced a second record for a vehicle that already
// existed — which is where the duplicate fleet came from (ZB-0050 accumulated
// 30 fuel issues that belonged to TM-21).
//
// Matching now falls back to a punctuation/case-insensitive comparison, and
// refuses to guess when the value matches more than one vehicle: several
// machines legitimately share a placeholder registration (five excavators all
// tagged "14160"), and silently picking one would post fuel to the wrong
// machine — a worse outcome than asking the operator to be specific.

export type AssetMatch =
  | { kind: "found"; asset: NonNullable<Awaited<ReturnType<typeof prisma.asset.findFirst>>> }
  | { kind: "ambiguous"; codes: string[] }
  | { kind: "none" };

export async function resolveAsset(input: string): Promise<AssetMatch> {
  const raw = input.trim();
  if (!raw) return { kind: "none" };
  const upper = raw.toUpperCase();

  // 1. Exact match on id / code / registration — the common, indexed path.
  //
  // findMany, not findFirst: several live vehicles legitimately share one
  // registration (five excavators all carry "14160", three mixers "FIORI"), and
  // the old findFirst silently posted the entry to whichever row the database
  // happened to return first. A disposed record never wins over a live one.
  const exactMatches = await prisma.asset.findMany({
    where: { OR: [{ id: raw }, { code: upper }, { regNo: upper }] },
  });
  const live = exactMatches.filter((a) => a.status !== "DISPOSED");
  const exact = live.length > 0 ? live : exactMatches;

  if (exact.length === 1) return { kind: "found", asset: exact[0] };
  if (exact.length > 1) {
    // An exact code match is unambiguous even if the registration is shared —
    // codes are unique, so "HEX-32" always means HEX-32.
    const byCode = exact.find((a) => a.code === upper || a.id === raw);
    if (byCode) return { kind: "found", asset: byCode };
    return { kind: "ambiguous", codes: exact.map((a) => a.code).sort() };
  }

  // 2. Normalized match: "ZA0050", "za 0050" and "ZA-0050" are one vehicle.
  const key = normKey(raw);
  if (key.length < 3) return { kind: "none" };

  const candidates = await prisma.asset.findMany({
    where: { status: { not: "DISPOSED" } },
    select: { id: true, code: true, regNo: true },
  });
  const hits = candidates.filter((a) => normKey(a.code) === key || normKey(a.regNo) === key);

  if (hits.length === 1) {
    const asset = await prisma.asset.findUnique({ where: { id: hits[0].id } });
    if (asset) return { kind: "found", asset };
    return { kind: "none" };
  }
  if (hits.length > 1) {
    return { kind: "ambiguous", codes: hits.map((h) => h.code).sort() };
  }
  return { kind: "none" };
}

/** Message shown when a typed value matches several vehicles. */
export function ambiguousAssetError(input: string, codes: string[]): string {
  return `"${input.trim()}" matches ${codes.length} vehicles (${codes.join(", ")}). Enter the exact E&C number instead.`;
}
