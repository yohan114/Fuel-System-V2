// Duplicate-vehicle detection. Site importers historically created a second
// asset for a vehicle that already existed in the master fleet, using its
// registration number (or a bare numeric sheet id, or a "#2" re-registration)
// as the code. This module groups assets that share a registration identity
// and plans which record survives — the merge itself lives in
// scripts/merge_duplicate_assets.ts, and /admin/data-quality surfaces the
// findings via runInvariantChecks.

export interface DedupeAsset {
  id: string;
  code: string;
  regNo: string | null;
  status: string;
  detailScore: number; // caller-computed richness (non-null detail fields etc.)
  createdAt: Date;
}

export interface PlannedMerge {
  key: string; // shared normalized registration identity
  survivor: DedupeAsset;
  duplicates: DedupeAsset[]; // 1–3, ranked less canonical than the survivor
}

export interface AmbiguousGroup {
  key: string;
  codes: string[];
  reason: "multiple-independent-codes" | "group-too-large" | "no-canonical";
}

export interface DedupePlan {
  merges: PlannedMerge[];
  ambiguous: AmbiguousGroup[];
}

export function normKey(s: string | null | undefined): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Fields that make one record "the detailed one" when picking a survivor.
export const ASSET_DETAIL_FIELDS = [
  "brand",
  "typeLabel",
  "model",
  "regNo",
  "chassisNo",
  "engineNo",
  "serialNo",
  "capacity",
  "yom",
  "site",
] as const;

export function detailScore(
  a: Partial<Record<(typeof ASSET_DETAIL_FIELDS)[number], unknown>> & { rentalRate?: unknown }
): number {
  return (
    ASSET_DETAIL_FIELDS.reduce((s, f) => s + (a[f] != null && a[f] !== "" ? 1 : 0), 0) + (a.rentalRate ? 1 : 0)
  );
}

// How canonical a code looks for a given group key (higher survives):
//   0 — "#N" re-registration suffix (RY-2390#2)
//   1 — bare numeric sheet id (46065)
//   2 — the registration itself used as the code (PJ-7604 when key is PJ7604)
//   3 — an independent E&C code (DT-29, WB-15)
export function codeRank(code: string, groupKey: string): 0 | 1 | 2 | 3 {
  if (/#\d+$/.test(code)) return 0;
  const n = normKey(code);
  if (/^\d+$/.test(n)) return 1;
  if (n === groupKey) return 2;
  return 3;
}

// At most this many duplicates fold into one survivor; bigger groups are
// almost certainly a shared placeholder (five excavators tagged "14160"), not
// one vehicle registered five times.
const MAX_DUPLICATES = 3;

export function planMerges(assets: DedupeAsset[]): DedupePlan {
  const live = assets.filter((a) => a.status !== "DISPOSED");

  // Union groups over shared identity keys: an asset belongs to a key when its
  // registration OR its code normalizes to it (VR-59 has no regNo of its own,
  // but 46073 carries "VR 59" as one).
  const regKeys = new Set<string>();
  for (const a of live) {
    const k = normKey(a.regNo);
    if (k.length >= 4) regKeys.add(k);
  }
  const groups = new Map<string, DedupeAsset[]>();
  for (const a of live) {
    const keys = new Set<string>();
    const rk = normKey(a.regNo);
    if (rk.length >= 4) keys.add(rk);
    const ck = normKey(a.code.replace(/#\d+$/, ""));
    if (ck.length >= 4 && regKeys.has(ck)) keys.add(ck);
    for (const k of keys) {
      const g = groups.get(k) ?? [];
      if (!g.some((m) => m.id === a.id)) g.push(a);
      groups.set(k, g);
    }
  }
  // An asset reachable through two keys chains those keys into one group.
  const byAsset = new Map<string, string[]>();
  for (const [k, members] of groups) {
    for (const m of members) {
      const ks = byAsset.get(m.id) ?? [];
      ks.push(k);
      byAsset.set(m.id, ks);
    }
  }
  const merged = new Map<string, Set<string>>(); // canonical key -> member ids
  const keyAlias = new Map<string, string>();
  const rootOf = (k: string): string => {
    let r = k;
    while (keyAlias.has(r)) r = keyAlias.get(r)!;
    return r;
  };
  for (const ks of byAsset.values()) {
    const roots = [...new Set(ks.map(rootOf))];
    const target = roots[0];
    for (const other of roots.slice(1)) if (other !== target) keyAlias.set(other, target);
  }
  for (const [k, members] of groups) {
    const root = rootOf(k);
    const set = merged.get(root) ?? new Set<string>();
    for (const m of members) set.add(m.id);
    merged.set(root, set);
  }
  const assetById = new Map(live.map((a) => [a.id, a]));

  const plan: DedupePlan = { merges: [], ambiguous: [] };
  for (const [key, ids] of merged) {
    if (ids.size < 2) continue;
    const members = [...ids].map((id) => assetById.get(id)!);
    const ranked = members.map((a) => ({ a, rank: codeRank(a.code, key) }));
    const maxRank = Math.max(...ranked.map((r) => r.rank));
    const canonicals = ranked.filter((r) => r.rank === maxRank);

    if (maxRank === 3 && canonicals.length > 1) {
      plan.ambiguous.push({ key, codes: members.map((m) => m.code).sort(), reason: "multiple-independent-codes" });
      continue;
    }
    if (members.length > MAX_DUPLICATES + 1) {
      plan.ambiguous.push({ key, codes: members.map((m) => m.code).sort(), reason: "group-too-large" });
      continue;
    }
    if (maxRank <= 1) {
      // only suffixed/numeric artifacts — nothing safe to keep
      plan.ambiguous.push({ key, codes: members.map((m) => m.code).sort(), reason: "no-canonical" });
      continue;
    }

    canonicals.sort(
      (x, y) =>
        y.a.detailScore - x.a.detailScore ||
        x.a.createdAt.getTime() - y.a.createdAt.getTime() ||
        x.a.code.localeCompare(y.a.code)
    );
    const survivor = canonicals[0].a;
    const duplicates = ranked
      .filter((r) => r.a.id !== survivor.id)
      .sort((x, y) => y.rank - x.rank || x.a.code.localeCompare(y.a.code))
      .map((r) => r.a);
    plan.merges.push({ key, survivor, duplicates });
  }

  plan.merges.sort((a, b) => a.survivor.code.localeCompare(b.survivor.code));
  plan.ambiguous.sort((a, b) => a.key.localeCompare(b.key));
  return plan;
}
