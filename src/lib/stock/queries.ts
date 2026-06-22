import { prisma } from "../db";
import { round3 } from "./classify";
import { currentBalances } from "./ledger";

export interface ProductRow {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  balance: number;
  reorderLevel: number | null;
  unitPriceCents: number | null;
  valueCents: number | null;
  low: boolean;
  active: boolean;
}

export interface ProductOverview {
  rows: ProductRow[];
  productCount: number;
  totalValueCents: number;
  lowStockCount: number;
}

/** All products with their current balance, value and low-stock flag. */
export async function productOverview(): Promise<ProductOverview> {
  const [products, balances] = await Promise.all([
    prisma.product.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] }),
    currentBalances(),
  ]);

  const rows: ProductRow[] = products.map((p) => {
    const balance = balances.get(p.id) ?? 0;
    const valueCents = p.unitPriceCents != null ? Math.round(balance * p.unitPriceCents) : null;
    const low = p.reorderLevel != null && balance <= p.reorderLevel;
    return {
      id: p.id, name: p.name, unit: p.unit, category: p.category,
      balance, reorderLevel: p.reorderLevel, unitPriceCents: p.unitPriceCents,
      valueCents, low, active: p.active,
    };
  });

  return {
    rows,
    productCount: rows.length,
    totalValueCents: rows.reduce((s, r) => s + (r.valueCents ?? 0), 0),
    lowStockCount: rows.filter((r) => r.low && r.active).length,
  };
}

export interface MovementRow {
  id: string;
  txnDate: Date;
  productName: string;
  unit: string;
  kind: string;
  qtyReceived: number;
  qtyIssued: number;
  balanceAfter: number;
  consumerLabel: string;
  description: string | null;
  actorName: string | null;
  voided: boolean;
}

/** Recent movements across all products, newest first, decorated for display. */
export async function recentMovements(limit = 80): Promise<MovementRow[]> {
  const moves = await prisma.stockMovement.findMany({
    orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      product: { select: { name: true, unit: true } },
      asset: { select: { code: true, regNo: true } },
      project: { select: { name: true } },
      site: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  return moves.map((m) => {
    let consumerLabel = "—";
    if (m.asset) consumerLabel = [m.asset.code, m.asset.regNo].filter(Boolean).join(" / ");
    else if (m.project) consumerLabel = m.site ? `${m.project.name} · ${m.site.name}` : m.project.name;
    else if (m.consumerType === "INTERNAL") consumerLabel = m.description || "Internal";
    return {
      id: m.id,
      txnDate: m.txnDate,
      productName: m.product.name,
      unit: m.product.unit,
      kind: m.kind,
      qtyReceived: m.qtyReceived,
      qtyIssued: m.qtyIssued,
      balanceAfter: m.balanceAfter,
      consumerLabel,
      description: m.description,
      actorName: m.createdBy?.name ?? null,
      voided: m.voided,
    };
  });
}

export interface AliasRow {
  id: string;
  rawText: string;
  hitCount: number;
}

/** Unresolved consumer descriptions needing a mapping, busiest first. */
export async function unresolvedAliases(): Promise<AliasRow[]> {
  const rows = await prisma.consumerAlias.findMany({
    where: { resolved: false },
    orderBy: [{ hitCount: "desc" }, { createdAt: "asc" }],
    take: 200,
    select: { id: true, rawText: true, hitCount: true },
  });
  return rows;
}

export interface ProjectOption {
  id: string;
  name: string;
  sites: { id: string; name: string }[];
}

/** Projects with their sites, for the issue / mapping selectors. */
export async function projectOptions(): Promise<ProjectOption[]> {
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, sites: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } } },
  });
  return projects;
}

export interface StockTakeRow {
  productId: string;
  name: string;
  unit: string;
  bookQty: number;
  countedQty: number | null;
  variance: number | null;
  adjusted: boolean;
}

/** Per-product stock-take status for a period (YYYY-MM): book balance vs count. */
export async function stockTakeStatus(period: string): Promise<StockTakeRow[]> {
  const [products, balances, counts] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    currentBalances(),
    prisma.stockCount.findMany({ where: { period } }),
  ]);
  const countByProduct = new Map(counts.map((c) => [c.productId, c]));

  return products.map((p) => {
    const bookQty = balances.get(p.id) ?? 0;
    const c = countByProduct.get(p.id);
    return {
      productId: p.id,
      name: p.name,
      unit: p.unit,
      bookQty,
      countedQty: c ? c.countedQty : null,
      variance: c ? round3(c.countedQty - bookQty) : null,
      adjusted: c ? c.adjusted : false,
    };
  });
}

/** YYYY-MM for the current month (Colombo is UTC+5:30; date-only month is stable). */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export interface RequisitionRow {
  id: string;
  productName: string;
  unit: string;
  projectName: string | null;
  siteName: string | null;
  qtyRequested: number | null;
  qtySent: number | null;
  qtyReceived: number | null;
  status: string;
  discrepancy: boolean;
  note: string | null;
  rejectReason: string | null;
  requestedBy: string | null;
  createdAt: Date;
}

export interface BatteryRow {
  id: string;
  vehicleNo: string;
  serialNo: string;
  note: string | null;
  createdAt: Date;
}

/** Live batteries (one per vehicle), newest first. */
export async function batteryList(): Promise<BatteryRow[]> {
  const rows = await prisma.battery.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, vehicleNo: true, serialNo: true, note: true, createdAt: true },
  });
  return rows;
}

export interface BatteryEventRow {
  id: string;
  action: string;
  serialNo: string | null;
  vehicleNo: string | null;
  fromVehicleNo: string | null;
  reason: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** Append-only battery audit history, newest first. */
export async function batteryHistory(limit = 100): Promise<BatteryEventRow[]> {
  const rows = await prisma.batteryEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { name: true } } },
  });
  return rows.map((e) => ({
    id: e.id,
    action: e.action,
    serialNo: e.serialNo,
    vehicleNo: e.vehicleNo,
    fromVehicleNo: e.fromVehicleNo,
    reason: e.reason,
    actorName: e.user?.name ?? null,
    createdAt: e.createdAt,
  }));
}

/** Recent requisitions, newest first, decorated with product/project/site names. */
export async function requisitionList(limit = 100): Promise<RequisitionRow[]> {
  const rows = await prisma.requisition.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      product: { select: { name: true, unit: true } },
      project: { select: { name: true } },
      site: { select: { name: true } },
      requestedBy: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    productName: r.product.name,
    unit: r.product.unit,
    projectName: r.project?.name ?? null,
    siteName: r.site?.name ?? null,
    qtyRequested: r.qtyRequested,
    qtySent: r.qtySent,
    qtyReceived: r.qtyReceived,
    status: r.status,
    discrepancy: r.discrepancy,
    note: r.note,
    rejectReason: r.rejectReason,
    requestedBy: r.requestedBy?.name ?? null,
    createdAt: r.createdAt,
  }));
}
