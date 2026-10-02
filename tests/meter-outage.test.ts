import { describe, expect, it } from "vitest";

// Pure business logic mirrors for meter outage management

interface MeterOutageRecord {
  id: string;
  assetId: string;
  startDate: Date;
  endDate: Date | null;
  reason: string | null;
  endPhysicalMeter: number | null;
  instrumentContinuity: "repaired" | "replaced" | null;
}

function canOpenOutage(
  existingOutages: MeterOutageRecord[],
  assetId: string,
): { ok: boolean; error?: string } {
  const open = existingOutages.find((o) => o.assetId === assetId && o.endDate === null);
  if (open) {
    return {
      ok: false,
      error: `Asset already has an active meter outage opened on ${open.startDate.toISOString().slice(0, 10)}. Close it before opening a new one.`,
    };
  }
  return { ok: true };
}

function validateCloseOutage(
  outage: MeterOutageRecord,
  endDate: Date,
  continuity: string,
  endMeter: number | null,
): { ok: boolean; error?: string; readingSource?: "REPAIR_RESUME" | "INSTRUMENT_RESET" } {
  if (outage.endDate !== null) {
    return { ok: false, error: "This meter outage has already been closed" };
  }
  if (continuity !== "repaired" && continuity !== "replaced") {
    return { ok: false, error: "Instrument continuity must be 'repaired' or 'replaced'" };
  }
  if (endDate < outage.startDate) {
    return { ok: false, error: "End date cannot be earlier than start date" };
  }
  if (endMeter !== null && (isNaN(endMeter) || endMeter < 0)) {
    return { ok: false, error: "Please enter a valid non-negative physical meter reading" };
  }

  const readingSource = continuity === "replaced" ? "INSTRUMENT_RESET" : "REPAIR_RESUME";
  return { ok: true, readingSource };
}

function isDateInOutage(outages: MeterOutageRecord[], assetId: string, date: Date): boolean {
  return outages.some(
    (o) =>
      o.assetId === assetId &&
      o.startDate <= date &&
      (o.endDate === null || o.endDate >= date),
  );
}

function resolveReadingSource(
  requestedSource: string | undefined,
  isEstimated: boolean,
  inOutage: boolean,
): string {
  if (requestedSource) return requestedSource;
  if (isEstimated || inOutage) return "GOOGLE_ESTIMATE";
  return "MANUAL";
}

describe("Meter Outage Management", () => {
  const asset1 = "asset-uuid-1";
  const start = new Date("2026-08-01T00:00:00+05:30");

  it("permits opening an outage when none is active", () => {
    const res = canOpenOutage([], asset1);
    expect(res.ok).toBe(true);
  });

  it("blocks opening a second outage when one is already active", () => {
    const outages: MeterOutageRecord[] = [
      {
        id: "out-1",
        assetId: asset1,
        startDate: start,
        endDate: null,
        reason: "Broken cable",
        endPhysicalMeter: null,
        instrumentContinuity: null,
      },
    ];
    const res = canOpenOutage(outages, asset1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already has an active meter outage/i);
  });

  it("allows opening a new outage after previous one is closed", () => {
    const outages: MeterOutageRecord[] = [
      {
        id: "out-1",
        assetId: asset1,
        startDate: start,
        endDate: new Date("2026-08-10T00:00:00+05:30"),
        reason: "Broken cable",
        endPhysicalMeter: 54200,
        instrumentContinuity: "repaired",
      },
    ];
    const res = canOpenOutage(outages, asset1);
    expect(res.ok).toBe(true);
  });

  it("validates that closing end date cannot precede start date", () => {
    const outage: MeterOutageRecord = {
      id: "out-1",
      assetId: asset1,
      startDate: new Date("2026-08-10T00:00:00+05:30"),
      endDate: null,
      reason: "Odometer gear stripped",
      endPhysicalMeter: null,
      instrumentContinuity: null,
    };
    const res = validateCloseOutage(outage, new Date("2026-08-05T00:00:00+05:30"), "repaired", 54200);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot be earlier than start date/i);
  });

  it("creates REPAIR_RESUME reading when closed as repaired", () => {
    const outage: MeterOutageRecord = {
      id: "out-1",
      assetId: asset1,
      startDate: new Date("2026-08-10T00:00:00+05:30"),
      endDate: null,
      reason: "Cable re-attached",
      endPhysicalMeter: null,
      instrumentContinuity: null,
    };
    const res = validateCloseOutage(outage, new Date("2026-08-15T00:00:00+05:30"), "repaired", 54200);
    expect(res.ok).toBe(true);
    expect(res.readingSource).toBe("REPAIR_RESUME");
  });

  it("creates INSTRUMENT_RESET reading when closed as replaced", () => {
    const outage: MeterOutageRecord = {
      id: "out-1",
      assetId: asset1,
      startDate: new Date("2026-08-10T00:00:00+05:30"),
      endDate: null,
      reason: "Cluster replaced with new unit",
      endPhysicalMeter: null,
      instrumentContinuity: null,
    };
    const res = validateCloseOutage(outage, new Date("2026-08-15T00:00:00+05:30"), "replaced", 0);
    expect(res.ok).toBe(true);
    expect(res.readingSource).toBe("INSTRUMENT_RESET");
  });

  it("detects whether a date falls inside an outage window", () => {
    const outages: MeterOutageRecord[] = [
      {
        id: "out-1",
        assetId: asset1,
        startDate: new Date("2026-08-10T00:00:00+05:30"),
        endDate: new Date("2026-08-20T00:00:00+05:30"),
        reason: "Outage",
        endPhysicalMeter: 1000,
        instrumentContinuity: "repaired",
      },
    ];

    expect(isDateInOutage(outages, asset1, new Date("2026-08-09T00:00:00+05:30"))).toBe(false);
    expect(isDateInOutage(outages, asset1, new Date("2026-08-15T00:00:00+05:30"))).toBe(true);
    expect(isDateInOutage(outages, asset1, new Date("2026-08-21T00:00:00+05:30"))).toBe(false);
  });

  it("resolves reading source to GOOGLE_ESTIMATE during an outage", () => {
    expect(resolveReadingSource(undefined, false, true)).toBe("GOOGLE_ESTIMATE");
    expect(resolveReadingSource(undefined, true, false)).toBe("GOOGLE_ESTIMATE");
    expect(resolveReadingSource(undefined, false, false)).toBe("MANUAL");
    expect(resolveReadingSource("FUEL_ISSUE", false, false)).toBe("FUEL_ISSUE");
  });
});
