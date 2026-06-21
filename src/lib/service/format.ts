// Some service records were imported without a source date and carry a
// 1970-01-01 sentinel (see scripts/import_service_db.ts). Render those as
// "Undated" instead of a misleading 1 Jan 1970.
const SENTINEL_MS = new Date("1970-01-02T00:00:00Z").getTime();

export function isUndatedService(d: Date | string | number): boolean {
  return new Date(d).getTime() < SENTINEL_MS;
}

export function fmtServiceDate(
  d: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
): string {
  if (isUndatedService(d)) return "Undated";
  return new Date(d).toLocaleDateString("en-GB", opts);
}
