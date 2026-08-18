// Guard against registering the same physical site twice under slightly
// different names. Because every new project auto-creates its own tank, a
// duplicate site silently produces a duplicate tank — which is how Badalgama
// ended up as "Badalgama", "Badalgama Plant" and "Badalgama Workshop", with
// the fuel issues on one tank and the balance on another.

// Words that describe a part of a site rather than the site itself. Two names
// that differ only by these refer to the same place.
const QUALIFIERS = new Set([
  "plant", "plants", "workshop", "workshops", "site", "sites", "yard",
  "store", "stores", "depot", "camp", "office", "project", "tank",
  "package", "lot", "new", "old", "main",
]);

// "Badalgama Workshop" / "Badalgama  PLANT " / "badalgama-plant" -> "badalgama"
export function normaliseSiteName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !QUALIFIERS.has(w))
    .join(" ")
    .trim();
}

export interface NamedProject {
  id: string;
  name: string;
  code: string;
}

// Returns an existing project that appears to be the same site, or null.
// An empty normalised form (a name made only of qualifiers, e.g. "Workshop")
// never matches — otherwise every such site would collide with every other.
export function findSimilarProject<T extends NamedProject>(
  name: string,
  projects: T[],
): T | null {
  const target = normaliseSiteName(name);
  if (!target) return null;
  return projects.find((p) => normaliseSiteName(p.name) === target) ?? null;
}
