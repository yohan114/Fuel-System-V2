// Service-interval resolution. Precedence: per-asset override → per-category
// config → hard-coded fleet-group default (machinery every 500 engine-hours,
// road vehicles every 5,000 km). All values are editable; the defaults below
// are the seed/fallback.

export const FLEET_GROUP_DEFAULTS: Record<string, { basis: "HOURS" | "KM"; intervalValue: number }> = {
  MACHINERY_GENSET: { basis: "HOURS", intervalValue: 500 },
  ROAD_VEHICLE: { basis: "KM", intervalValue: 5000 },
};

export interface IntervalConfig {
  basis: string;
  intervalValue: number;
  intervalMonths: number | null;
}

export interface ResolvedInterval {
  basis: "HOURS" | "KM";
  intervalValue: number;
  intervalMonths: number | null;
  source: "asset" | "category" | "default";
}

export function resolveInterval(
  fleetGroup: string,
  meterType: string,
  assetOverride?: IntervalConfig | null,
  categoryInterval?: IntervalConfig | null
): ResolvedInterval {
  if (assetOverride) {
    return {
      basis: (assetOverride.basis as "HOURS" | "KM") || (meterType === "KM" ? "KM" : "HOURS"),
      intervalValue: assetOverride.intervalValue,
      intervalMonths: assetOverride.intervalMonths ?? null,
      source: "asset",
    };
  }
  if (categoryInterval) {
    return {
      basis: (categoryInterval.basis as "HOURS" | "KM") || (meterType === "KM" ? "KM" : "HOURS"),
      intervalValue: categoryInterval.intervalValue,
      intervalMonths: categoryInterval.intervalMonths ?? null,
      source: "category",
    };
  }
  const def =
    FLEET_GROUP_DEFAULTS[fleetGroup] ||
    (meterType === "KM" ? { basis: "KM" as const, intervalValue: 5000 } : { basis: "HOURS" as const, intervalValue: 500 });
  return { basis: def.basis, intervalValue: def.intervalValue, intervalMonths: null, source: "default" };
}

// Due-soon band: within 10% of the interval remaining.
export function dueSoonThreshold(intervalValue: number): number {
  return intervalValue * 0.1;
}
