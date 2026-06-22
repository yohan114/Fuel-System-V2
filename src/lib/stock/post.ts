import { prisma } from "../db";
import { round3, type ConsumerType, type MovementKind } from "./classify";

const EPS = 0.0001;

/** Raised when an issue/void would drive a product's book balance negative. */
export class OverIssueError extends Error {
  constructor(
    public productName: string,
    public available: number,
    public requested: number,
  ) {
    super(`Only ${available} in stock for ${productName}; cannot issue ${requested}.`);
    this.name = "OverIssueError";
  }
}

export interface PostMovementInput {
  productId: string;
  kind: MovementKind;
  qtyReceived?: number;
  qtyIssued?: number;
  txnDate?: Date;
  consumerType?: ConsumerType | null;
  assetId?: string | null;
  projectId?: string | null;
  siteId?: string | null;
  description?: string | null;
  mrNo?: string | null;
  mtnNo?: string | null;
  remark?: string | null;
  serviceRecordId?: string | null;
  source?: string;
  createdById?: string | null;
}

/**
 * Post a single stock movement and return the new balance. Enforces the
 * over-issue guard: the server refuses any movement that would drive the
 * product's running balance negative (ported from Oil Stock Book's "issue only
 * what is in stock" rule). Read-guard-insert runs in one transaction.
 *
 * Designed for in-app (current-dated) entries, which append to the end of the
 * ledger. Back-dated bulk loads should go through the importer, which
 * reconciles and recomputes the whole ledger.
 */
export async function postMovement(
  input: PostMovementInput,
): Promise<{ id: string; balanceAfter: number }> {
  const qtyReceived = round3(Math.max(0, input.qtyReceived ?? 0));
  const qtyIssued = round3(Math.max(0, input.qtyIssued ?? 0));
  if (qtyReceived === 0 && qtyIssued === 0) {
    throw new Error("A movement must receive or issue a positive quantity.");
  }

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true },
    });
    if (!product) throw new Error("Product not found.");

    const last = await tx.stockMovement.findFirst({
      where: { productId: input.productId, voided: false },
      orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { balanceAfter: true },
    });
    const current = last?.balanceAfter ?? 0;
    const balanceAfter = round3(current + qtyReceived - qtyIssued);

    if (balanceAfter < -EPS) {
      throw new OverIssueError(product.name, current, qtyIssued);
    }

    const created = await tx.stockMovement.create({
      data: {
        productId: input.productId,
        txnDate: input.txnDate ?? new Date(),
        kind: input.kind,
        qtyReceived,
        qtyIssued,
        balanceAfter,
        consumerType: input.consumerType ?? null,
        assetId: input.assetId ?? null,
        projectId: input.projectId ?? null,
        siteId: input.siteId ?? null,
        description: input.description ?? null,
        mrNo: input.mrNo ?? null,
        mtnNo: input.mtnNo ?? null,
        remark: input.remark ?? null,
        serviceRecordId: input.serviceRecordId ?? null,
        source: input.source ?? "manual",
        createdById: input.createdById ?? null,
      },
      select: { id: true, balanceAfter: true },
    });
    return created;
  });
}

/**
 * Soft-void a movement (kept for the audit trail) and recompute the product's
 * ledger. Refuses the void if it would make any running balance negative — e.g.
 * voiding a receipt that later issues depend on.
 */
export async function voidMovement(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const mv = await tx.stockMovement.findUnique({
      where: { id },
      select: { id: true, productId: true, voided: true },
    });
    if (!mv || mv.voided) return;

    await tx.stockMovement.update({
      where: { id },
      data: { voided: true, voidedAt: new Date() },
    });

    const rows = await tx.stockMovement.findMany({
      where: { productId: mv.productId, voided: false },
      orderBy: [{ txnDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, qtyReceived: true, qtyIssued: true, balanceAfter: true },
    });

    let running = 0;
    let min = 0;
    const updates: { id: string; balanceAfter: number }[] = [];
    for (const r of rows) {
      running = round3(running + r.qtyReceived - r.qtyIssued);
      if (running < min) min = running;
      if (running !== r.balanceAfter) updates.push({ id: r.id, balanceAfter: running });
    }
    if (min < -EPS) {
      throw new Error("Voiding this movement would make the stock balance negative.");
    }
    for (const u of updates) {
      await tx.stockMovement.update({ where: { id: u.id }, data: { balanceAfter: u.balanceAfter } });
    }
  });
}
