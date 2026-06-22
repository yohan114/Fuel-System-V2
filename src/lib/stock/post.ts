import { prisma } from "../db";
import { normalize, round3, type ConsumerType, type MovementKind } from "./classify";

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

interface ServiceOilLine {
  oilName: string;
  oilType: string | null;
  quantity: number;
}

/**
 * Close the service↔stock loop: post ISSUE movements for the oils a service
 * consumed, linked to the serviced machine, so the store balance falls and the
 * oil cost lands on that asset's TCO. Each oil line is matched to a Product by
 * normalized name (grade first, then line name) — only a *single* confident
 * match is drawn down; ambiguous or unmatched lines are skipped rather than
 * guessed. Best-effort and ledger-safe: an over-issue (or any error) skips the
 * line, so a short store or a hiccup never blocks logging the service. The
 * caller already wraps this in its own try/catch.
 */
export async function postServiceOilConsumption(
  serviceRecordId: string,
  assetId: string,
  lines: ServiceOilLine[],
  createdById: string | null,
): Promise<number> {
  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, name: true } });
  const keyed = products.map((p) => ({ id: p.id, key: normalize(p.name) }));

  let posted = 0;
  for (const l of lines) {
    const qty = round3(Number(l.quantity) || 0);
    if (qty <= 0) continue;

    let matchId: string | null = null;
    for (const candidate of [normalize(l.oilType), normalize(l.oilName)]) {
      if (!candidate || candidate.length < 3) continue;
      const hits = keyed.filter((p) => p.key.includes(candidate) || candidate.includes(p.key));
      if (hits.length === 1) { matchId = hits[0].id; break; }
    }
    if (!matchId) continue;

    try {
      await postMovement({
        productId: matchId,
        kind: "ISSUE",
        qtyIssued: qty,
        consumerType: "ASSET",
        assetId,
        serviceRecordId,
        source: "service",
        description: `Service oil: ${l.oilName}${l.oilType ? ` (${l.oilType})` : ""}`,
        createdById,
      });
      posted++;
    } catch {
      // Over-issue or other — skip this line; never block the service log.
    }
  }
  return posted;
}
