// Finding a machine by whatever the user happens to type.
//
// A registration is written half a dozen ways across the yard, the fuel sheets
// and the workshop: "BIE-8552", "BIE 8552", "bie8552". An E&C code is typed as
// "HEX-37", "hex 37" or "HEX37". Squashing the separators and comparing
// uppercase means any of those finds the machine, which is what someone at a
// keyboard expects — matching the plate exactly is a computer's idea of search,
// not a person's.

const squash = (s: string) => s.replace(/[-\s/().]/g, "").toUpperCase();

export interface SearchableVehicle {
  /** E&C fleet code, e.g. "HEX-37". */
  code: string;
  /** Registration number, absent on a good number of records. */
  regNo?: string | null;
  /** Free-text description, e.g. "CASE CX220C LC HD". */
  label?: string | null;
}

/**
 * True when the query matches the vehicle's code, registration or description.
 *
 * An empty query matches everything, so a caller can pass the raw input straight
 * through without special-casing the blank state.
 */
export function matchesVehicle(v: SearchableVehicle, query: string): boolean {
  const q = squash(query);
  if (!q) return true;
  if (squash(v.code).includes(q)) return true;
  if (v.regNo && squash(v.regNo).includes(q)) return true;
  // The description is matched on the raw words rather than squashed, so that
  // typing "case" finds a CASE excavator without "ca-se" also matching.
  if (v.label && v.label.toUpperCase().includes(query.trim().toUpperCase())) return true;
  return false;
}

/** Looks like a Sri Lankan plate — used to explain an empty result helpfully. */
export function looksLikePlate(query: string): boolean {
  return /^[A-Z]{2,3}[-\s]?[0-9]{4}$|^[0-9]{2,3}[-\s]?[0-9]{4}$/i.test(query.trim());
}
