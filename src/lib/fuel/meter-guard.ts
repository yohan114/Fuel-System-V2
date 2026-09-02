// The "readings cannot go backwards" check applied when fuel is recorded.
//
// It used to compare against the machine's HIGHEST reading of ANY source, which
// is wrong twice over.
//
// SERVICE READINGS ARE NOT A BASELINE FOR FUEL. They come from WorkshopOne's
// meter column, typed by hand for three years, and src/lib/service/meter-trust.ts
// exists precisely because they cannot be trusted on their own — it already
// refuses the absurd ones before they enter the history. The ones that get
// through are still a different instrument read by a different person at a
// different time, and 132 machines in this fleet currently have a SERVICE
// reading as their highest. On those, a pump operator entering the correct
// figure off the dashboard is refused, and the message tells them their reading
// is wrong when it is the stored one that is.
//
// THE HIGHEST READING IS NOT THE LATEST ONE. Ordering by value means a single
// mistyped high figure blocks that machine for good: DT-64 carried 39,883 km
// from a 2023 service while the truck actually reads 19,499. A meter that is
// replaced legitimately restarts low, and ordering by value can never see that.
//
// So: compare against the most recent FUEL_ISSUE reading dated on or before the
// entry being made. That is the same instrument, the same kind of observation,
// and the only sequence a fuel reading has to be consistent with.

/** Just enough of the Prisma client for the lookup — keeps this file free of a
 *  database import so the rule below can be unit-tested. */
export interface MeterReadingSource {
  meterReading: {
    findFirst(args: unknown): Promise<{ value: number; readingDate: Date } | null>;
  };
}

export interface MeterGuardResult {
  ok: boolean;
  /** Message to show the operator when ok is false. */
  error?: string;
  /** What the new reading was judged against, for the message and for tests. */
  previous?: { value: number; on: Date };
}

/**
 * Decide whether a fuel meter reading may be accepted.
 *
 * Pure, so the rule can be tested without a database. `previous` is the last
 * fuel-issue reading on or before the entry's date, or null when the machine
 * has none — a machine's first fuel reading is always accepted, because there
 * is nothing of the same kind to compare it with.
 */
export function judgeFuelMeter(
  value: number,
  previous: { value: number; on: Date } | null,
): MeterGuardResult {
  if (previous && value < previous.value) {
    return {
      ok: false,
      previous,
      error:
        `Reading ${value.toLocaleString()} is below the last fuel reading for this machine, ` +
        `${previous.value.toLocaleString()} on ${previous.on.toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" })}. ` +
        `Readings cannot go backwards. If the meter has been replaced, record the reading without it and raise the change with the workshop.`,
    };
  }
  return { ok: true, previous: previous ?? undefined };
}

/**
 * The reading a new fuel entry must not fall below: the machine's most recent
 * FUEL_ISSUE reading dated on or before `on`.
 *
 * Deliberately excludes SERVICE and MANUAL. A backdated entry is compared with
 * what preceded it rather than with everything on file, so correcting an old
 * day does not fail against a newer reading.
 */
export async function previousFuelMeter(
  db: MeterReadingSource,
  assetId: string,
  meterType: string,
  on: Date,
): Promise<{ value: number; on: Date } | null> {
  const row = await db.meterReading.findFirst({
    where: {
      assetId,
      readingType: meterType,
      source: "FUEL_ISSUE",
      readingDate: { lte: on },
    },
    orderBy: [{ readingDate: "desc" }, { value: "desc" }],
    select: { value: true, readingDate: true },
  });
  return row ? { value: row.value, on: row.readingDate } : null;
}

/** Convenience: look up the baseline and judge in one call. */
export async function checkFuelMeter(
  db: MeterReadingSource,
  assetId: string,
  meterType: string,
  value: number,
  on: Date,
): Promise<MeterGuardResult> {
  return judgeFuelMeter(value, await previousFuelMeter(db, assetId, meterType, on));
}
