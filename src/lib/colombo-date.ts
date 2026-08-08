// Fuel dates belong to the pump attendant's day, not the server's.
//
// Issues are stored as instants. Imported rows sit at Colombo midnight, which is
// 18:30 UTC on the previous day, so a `toLocaleDateString()` with no timeZone
// prints the day BEFORE on any UTC host — the whole of a site's 4 August work
// appears under 3 August, and counting a day against the source sheet never
// agrees. Operator rows carry real clock times and shift the same 5½ hours.
//
// Every screen that shows a fuel date goes through here. The server's zone is a
// deployment accident; Asia/Colombo is the business fact.
export const COLOMBO = "Asia/Colombo";

// "4 Aug 2026"
export function fuelDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: COLOMBO,
  });
}

// "4 Aug" — for tight columns and chart ticks where the year is implied.
export function fuelDateShort(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    day: "numeric", month: "short", timeZone: COLOMBO,
  });
}

// "04 Aug" — the zero-padded British form the billing tables use.
export function fuelDateGB(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", timeZone: COLOMBO,
  });
}

// "4 Aug 2026, 06:30 AM" — the issue log, where the time of day matters because
// it distinguishes an operator's entry from an imported row at midnight.
export function fuelDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: COLOMBO,
  });
}

// "2026-08-04" — sortable, and the form date inputs and grouping keys want.
export function colomboDayKey(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: COLOMBO });
}
