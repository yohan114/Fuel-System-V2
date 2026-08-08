// Bill revision snapshots.
//
// Regenerating a DRAFT bill overwrites its row and deletes its line items, so
// the prior invoice figures are lost. Before that happens we capture a
// structured snapshot of the bill's financial state into a BillRevision row.
// That gives an auditable trail: every prior version of an invoice can be
// reconstructed and diffed against what replaced it, which is what makes a
// regenerate defensible to a client who saw the earlier number.
//
// Everything here is pure so the snapshot shape and the diff are unit-testable
// without a database.

export interface RevisionLineItem {
  kind: string;
  description: string;
  quantity: number;
  unit: string;
  unitRateCents: number;
  amountCents: number;
  projectName?: string | null;
}

export interface BillSnapshot {
  billingMode: string;
  rateCents: number;
  actualUnits: number;
  minimumUnits: number;
  billableUnits: number;
  rentalAmountCents: number;
  fuelLitres: number;
  fuelCostCents: number;
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
  lineItems: RevisionLineItem[];
}

// Structural view of the fields a persisted bill must expose to be snapshotted.
export interface SnapshotSourceBill {
  billingMode: string;
  rateCents: number;
  actualUnits: number;
  minimumUnits: number;
  billableUnits: number;
  rentalAmountCents: number;
  fuelLitres: number;
  fuelCostCents: number;
  subtotalCents: number;
  ssclCents: number;
  vatCents: number;
  grandTotalCents: number;
}

export function buildBillSnapshot(
  bill: SnapshotSourceBill,
  lineItems: RevisionLineItem[],
): BillSnapshot {
  return {
    billingMode: bill.billingMode,
    rateCents: bill.rateCents,
    actualUnits: bill.actualUnits,
    minimumUnits: bill.minimumUnits,
    billableUnits: bill.billableUnits,
    rentalAmountCents: bill.rentalAmountCents,
    fuelLitres: bill.fuelLitres,
    fuelCostCents: bill.fuelCostCents,
    subtotalCents: bill.subtotalCents,
    ssclCents: bill.ssclCents,
    vatCents: bill.vatCents,
    grandTotalCents: bill.grandTotalCents,
    lineItems: lineItems.map((li) => ({
      kind: li.kind,
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      unitRateCents: li.unitRateCents,
      amountCents: li.amountCents,
      projectName: li.projectName ?? null,
    })),
  };
}

// Parse a stored snapshot JSON blob back into a BillSnapshot. Returns null when
// the payload is missing or malformed so callers can degrade gracefully rather
// than throw while rendering an invoice.
export function parseBillSnapshot(json: string | null | undefined): BillSnapshot | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<BillSnapshot>;
    if (parsed == null || typeof parsed !== "object") return null;
    if (typeof parsed.grandTotalCents !== "number") return null;
    return {
      billingMode: String(parsed.billingMode ?? ""),
      rateCents: parsed.rateCents ?? 0,
      actualUnits: parsed.actualUnits ?? 0,
      minimumUnits: parsed.minimumUnits ?? 0,
      billableUnits: parsed.billableUnits ?? 0,
      rentalAmountCents: parsed.rentalAmountCents ?? 0,
      fuelLitres: parsed.fuelLitres ?? 0,
      fuelCostCents: parsed.fuelCostCents ?? 0,
      subtotalCents: parsed.subtotalCents ?? 0,
      ssclCents: parsed.ssclCents ?? 0,
      vatCents: parsed.vatCents ?? 0,
      grandTotalCents: parsed.grandTotalCents,
      lineItems: Array.isArray(parsed.lineItems) ? parsed.lineItems : [],
    };
  } catch {
    return null;
  }
}

function money(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function signedMoney(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${money(Math.abs(cents))}`;
}

function num(n: number): string {
  return n.toLocaleString("en-LK", { maximumFractionDigits: 2 });
}

// Unit figures are floats recomputed on every regenerate, so re-deriving the
// same quantity can land a hair off (3000 vs 2999.9999997). Only treat a unit
// change as real once it would show differently at the 2-dp precision we print,
// otherwise the diff fills with phantom "3,000 → 3,000" rows. Cent fields are
// integers and compared exactly.
function unitsChanged(a: number, b: number): boolean {
  return Math.abs(a - b) >= 0.005;
}

// Human-readable list of what changed moving from a prior snapshot to the state
// that superseded it. Empty when the two are financially identical (a no-op
// regenerate). Ordered from headline figure down to the underlying drivers.
export function summarizeRevisionDiff(prev: BillSnapshot, curr: BillSnapshot): string[] {
  const out: string[] = [];

  if (prev.grandTotalCents !== curr.grandTotalCents) {
    out.push(
      `Grand total ${money(prev.grandTotalCents)} → ${money(curr.grandTotalCents)} (${signedMoney(
        curr.grandTotalCents - prev.grandTotalCents,
      )})`,
    );
  }
  if (prev.subtotalCents !== curr.subtotalCents) {
    out.push(
      `Subtotal ${money(prev.subtotalCents)} → ${money(curr.subtotalCents)} (${signedMoney(
        curr.subtotalCents - prev.subtotalCents,
      )})`,
    );
  }
  if (prev.rentalAmountCents !== curr.rentalAmountCents) {
    out.push(`Rental ${money(prev.rentalAmountCents)} → ${money(curr.rentalAmountCents)}`);
  }
  if (prev.fuelCostCents !== curr.fuelCostCents) {
    out.push(`Fuel charge ${money(prev.fuelCostCents)} → ${money(curr.fuelCostCents)}`);
  }
  if (unitsChanged(prev.billableUnits, curr.billableUnits)) {
    out.push(`Billable units ${num(prev.billableUnits)} → ${num(curr.billableUnits)}`);
  }
  if (unitsChanged(prev.actualUnits, curr.actualUnits)) {
    out.push(`Actual units ${num(prev.actualUnits)} → ${num(curr.actualUnits)}`);
  }
  if (unitsChanged(prev.fuelLitres, curr.fuelLitres)) {
    out.push(`Fuel ${num(prev.fuelLitres)} L → ${num(curr.fuelLitres)} L`);
  }
  if (prev.rateCents !== curr.rateCents) {
    out.push(`Rate ${money(prev.rateCents)} → ${money(curr.rateCents)}`);
  }
  if (prev.lineItems.length !== curr.lineItems.length) {
    out.push(`Line items ${prev.lineItems.length} → ${curr.lineItems.length}`);
  }

  return out;
}
