// Part-number normalization for the filter cross-reference engine. Suppliers
// write the same filter as "SO 10058", "so-10058" or "SO10058"; matching runs
// on the uppercase alphanumeric skeleton.

export function normalizePN(s: string | null | undefined): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Price lists write codes as "C115 (VIC Japan)" — code plus the quoting
// supplier in parentheses.
export function parseSupplierCode(s: string): { code: string; supplier: string | null } {
  const m = String(s).match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) return { code: m[1].trim(), supplier: m[2].trim() };
  return { code: String(s).trim(), supplier: null };
}
