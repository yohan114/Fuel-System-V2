import { prisma } from "../db";

export type PoStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";

export interface PoLineInput {
  normalizedCode: string;
  filterNo: string | null;
  category: string | null;
  qtyOrdered: number;
  unitCostCents: number | null;
}

/** Next human-readable PO number, e.g. `PO-2026-0007`, sequential within the year. */
export async function nextPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const count = await prisma.filterPurchaseOrder.count({ where: { poNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/**
 * Create a DRAFT purchase order with the given lines. Allocates a PO number and
 * retries on the (rare) unique-number race. Returns the new PO id.
 */
export async function createPurchaseOrder(opts: {
  createdById?: string | null;
  supplier?: string | null;
  note?: string | null;
  lines: PoLineInput[];
}): Promise<string> {
  const lines = opts.lines.filter((l) => l.normalizedCode && l.qtyOrdered > 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const poNumber = await nextPoNumber();
    try {
      const po = await prisma.filterPurchaseOrder.create({
        data: {
          poNumber,
          status: "DRAFT",
          supplier: opts.supplier?.trim() || null,
          note: opts.note?.trim() || null,
          createdById: opts.createdById ?? null,
          lines: {
            create: lines.map((l) => ({
              normalizedCode: l.normalizedCode,
              filterNo: l.filterNo,
              category: l.category,
              qtyOrdered: Math.max(0, Math.trunc(l.qtyOrdered)),
              unitCostCents: l.unitCostCents,
            })),
          },
        },
      });
      return po.id;
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002" && attempt < 4) continue; // poNumber collided — try the next number
      throw e;
    }
  }
  throw new Error("Could not allocate a PO number");
}

export interface PoSummary {
  id: string;
  poNumber: string;
  status: string;
  supplier: string | null;
  createdAt: Date;
  orderedAt: Date | null;
  receivedAt: Date | null;
  lineCount: number;
  totalOrdered: number;
  totalReceived: number;
  orderCostCents: number;
}

function lineCost(unitCostCents: number | null, qty: number): number {
  return unitCostCents != null ? unitCostCents * qty : 0;
}

export async function listPurchaseOrders(): Promise<PoSummary[]> {
  const pos = await prisma.filterPurchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
  return pos.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    supplier: po.supplier,
    createdAt: po.createdAt,
    orderedAt: po.orderedAt,
    receivedAt: po.receivedAt,
    lineCount: po.lines.length,
    totalOrdered: po.lines.reduce((s, l) => s + l.qtyOrdered, 0),
    totalReceived: po.lines.reduce((s, l) => s + l.qtyReceived, 0),
    orderCostCents: po.lines.reduce((s, l) => s + lineCost(l.unitCostCents, l.qtyOrdered), 0),
  }));
}

export async function getPurchaseOrder(id: string) {
  return prisma.filterPurchaseOrder.findUnique({
    where: { id },
    include: { lines: { orderBy: [{ filterNo: "asc" }, { category: "asc" }] } },
  });
}

/** Aggregate counters for a PO's open/received state. */
export function poProgress(lines: { qtyOrdered: number; qtyReceived: number; unitCostCents: number | null }[]) {
  const totalOrdered = lines.reduce((s, l) => s + l.qtyOrdered, 0);
  const totalReceived = lines.reduce((s, l) => s + l.qtyReceived, 0);
  const orderCostCents = lines.reduce((s, l) => s + lineCost(l.unitCostCents, l.qtyOrdered), 0);
  const receivedCostCents = lines.reduce((s, l) => s + lineCost(l.unitCostCents, l.qtyReceived), 0);
  const fullyReceived = totalOrdered > 0 && lines.every((l) => l.qtyReceived >= l.qtyOrdered);
  return { totalOrdered, totalReceived, orderCostCents, receivedCostCents, fullyReceived };
}
