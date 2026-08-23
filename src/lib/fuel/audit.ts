import type { Prisma } from "@prisma/client";
import { colomboDayKey, colomboMonthKey } from "../colombo-date";

// What happened to a fuel issue, in a form somebody can read back.
//
// The log already recorded that an issue was edited. It recorded it as a
// sentence — "litres from 40L to 60L" — which reads well and answers nothing
// else: not what the price was, not which tank gave up the difference, not
// which bill moved. Of 1,055 fuel-issue audit rows only 20 carried any
// structured payload at all, so "what did this say before" was, in practice,
// unanswerable.
//
// Every path that creates, changes or voids an issue now writes the same shape:
// the fields that actually differed, each with its before and after, plus the
// three consequences that follow from a litre changing — the tank balance, the
// meter reading hanging off the issue, and the month whose bill has to be
// redone. An entry is worth writing only if it can be acted on later.

export type FuelAuditAction = "CREATE" | "UPDATE" | "VOID" | "UNVOID";

/** A field that moved, and what it moved between. */
export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface FuelIssueSnapshot {
  assetId: string;
  assetCode: string;
  fuelKind: string;
  litres: number;
  meterReading: number | null;
  readingType: string | null;
  pricePerLitre: number;
  totalCost: number;
  source: string;
  issueDate: Date;
  bulkTankId: string | null;
  bulkTankName?: string | null;
  voided?: boolean;
}

export interface FuelAuditMeta {
  action: FuelAuditAction;
  issueId: string;
  changes: FieldChange[];
  /** Litres added back to (+) or drawn from (−) the tank by this change. */
  tankDeltaLitres?: number;
  tankId?: string | null;
  tankName?: string | null;
  /** What became of the MeterReading row this issue owns. */
  meterReading?: "created" | "updated" | "deleted" | "unchanged";
  /** The billing month this touches, so a regeneration can be traced to it. */
  periodKey?: string;
  /** Required for a void, and for an edit the numbers alone do not explain. */
  reason?: string | null;
}

const FIELDS: (keyof FuelIssueSnapshot)[] = [
  "assetCode", "fuelKind", "litres", "meterReading", "readingType",
  "pricePerLitre", "totalCost", "source", "issueDate", "bulkTankId", "voided",
];

/** Only the fields that actually moved. An unchanged field is noise. */
export function diffSnapshots(before: FuelIssueSnapshot, after: FuelIssueSnapshot): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of FIELDS) {
    const a = before[f];
    const b = after[f];
    // Dates compare by instant, not by object identity.
    const same = a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
    if (!same) out.push({ field: f, from: serialise(a), to: serialise(b) });
  }
  return out;
}

function serialise(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v ?? null;
}

/** The billing month a fuel issue falls in, on Colombo days. */
export function periodKeyFor(issueDate: Date): string {
  return colomboMonthKey(issueDate);
}

const LABEL: Record<string, string> = {
  assetCode: "machine", fuelKind: "fuel", litres: "litres", meterReading: "meter",
  readingType: "meter type", pricePerLitre: "price/L", totalCost: "cost",
  source: "source", issueDate: "date", bulkTankId: "tank", voided: "voided",
};

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return colomboDayKey(new Date(v));
  return String(v);
};

/**
 * One line a person can read, from the same data the payload holds. Kept in
 * step with the payload deliberately: a summary written separately drifts from
 * what actually happened, which is how the old one came to say only three of
 * the eleven fields it had changed.
 */
export function summarise(meta: FuelAuditMeta, assetCode: string): string {
  const verb = { CREATE: "Recorded", UPDATE: "Edited", VOID: "Voided", UNVOID: "Restored" }[meta.action];
  const head = `${verb} fuel issue for ${assetCode}`;
  const parts: string[] = [];

  if (meta.changes.length) {
    parts.push(meta.changes.map((c) => `${LABEL[c.field] ?? c.field} ${show(c.from)} → ${show(c.to)}`).join(", "));
  }
  if (meta.tankDeltaLitres) {
    const d = meta.tankDeltaLitres;
    parts.push(`${d > 0 ? "returned" : "drew"} ${Math.abs(d).toLocaleString("en-LK", { maximumFractionDigits: 1 })} L ${d > 0 ? "to" : "from"} ${meta.tankName ?? "the tank"}`);
  }
  if (meta.meterReading && meta.meterReading !== "unchanged") parts.push(`meter reading ${meta.meterReading}`);
  if (meta.periodKey) parts.push(`affects ${meta.periodKey}`);
  if (meta.reason) parts.push(`reason: ${meta.reason}`);

  return parts.length ? `${head} — ${parts.join("; ")}` : head;
}

/**
 * Write the entry. Takes a transaction client so the record cannot survive a
 * rolled-back change, nor a change outlive its record.
 */
export async function logFuelIssueChange(
  tx: Prisma.TransactionClient,
  actorId: string | null,
  assetCode: string,
  meta: FuelAuditMeta,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId,
      // The audit vocabulary is CREATE/UPDATE/DELETE; a void is a soft delete
      // and an unvoid puts it back, so both are recorded as what they do to the
      // row rather than inventing verbs the rest of the log does not use.
      action: meta.action === "VOID" ? "DELETE" : meta.action === "UNVOID" ? "UPDATE" : meta.action,
      entity: "FuelIssue",
      entityId: meta.issueId,
      summary: summarise(meta, assetCode),
      metaJson: JSON.stringify(meta),
    },
  });
}
