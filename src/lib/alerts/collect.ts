import { prisma } from "../db";
import { currentMonthPeriod } from "../billing/period";
import { detectAnomalies } from "../integrity/anomalies";
import { getTankReconciliation } from "../integrity/tank";
import { getFleetServiceStatus } from "../service/fleet";
import { currentBalances } from "../stock/ledger";

// A single operational alert. Alerts are computed live from current state, so
// they clear automatically once the underlying item is handled.
export interface Alert {
  key: string;
  category: "APPROVAL" | "INTEGRITY" | "BILLING" | "DATA" | "TANK" | "SERVICE" | "STOCK";
  severity: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
  href: string;
}

const rank: Record<Alert["severity"], number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Gathers the open operational alerts. When projectId is given (a site PM), the
// feed is scoped to that site and admin-only sources (tanks, fleet-wide data
// quality, bulk requests) are omitted.
export async function collectAlerts(opts: { projectId?: string; isAdmin: boolean }): Promise<Alert[]> {
  const { projectId, isAdmin } = opts;
  const period = currentMonthPeriod();
  const alerts: Alert[] = [];

  // 1. Pending fuel corrections (edit/void with proof) awaiting admin review.
  const pendingCorrections = await prisma.fuelIssueCorrection.count({
    where: { status: "PENDING", ...(projectId ? { projectId } : {}) },
  });
  if (pendingCorrections > 0) {
    alerts.push({
      key: "corrections-pending",
      category: "APPROVAL",
      severity: "MEDIUM",
      title: `${pendingCorrections} correction request${pendingCorrections !== 1 ? "s" : ""} pending`,
      detail: "Edit/void requests with proof are awaiting admin review.",
      href: "/fuel/corrections",
    });
  }

  // 2. Pending fuel requests.
  const pendingRequests = await prisma.fuelRequest.count({
    where: { status: "PENDING", ...(projectId ? { asset: { projectId } } : {}) },
  });
  if (pendingRequests > 0) {
    alerts.push({
      key: "requests-pending",
      category: "APPROVAL",
      severity: "MEDIUM",
      title: `${pendingRequests} fuel request${pendingRequests !== 1 ? "s" : ""} pending`,
      detail: "Fuel requests are awaiting approval.",
      href: "/fuel/requests",
    });
  }

  // 3. Overdue bills.
  const overdueBills = await prisma.bill.count({
    where: { status: "OVERDUE", ...(projectId ? { projectId } : {}) },
  });
  if (overdueBills > 0) {
    alerts.push({
      key: "bills-overdue",
      category: "BILLING",
      severity: "HIGH",
      title: `${overdueBills} overdue invoice${overdueBills !== 1 ? "s" : ""}`,
      detail: "Issued invoices are past their due date.",
      href: "/billing",
    });
  }

  // 4. Active vehicles with no meter reading this month.
  const activeAssets = await prisma.asset.findMany({
    where: { status: "ACTIVE", ...(projectId ? { projectId } : {}) },
    select: { id: true },
  });
  if (activeAssets.length > 0) {
    const withReading = await prisma.meterReading.findMany({
      where: { assetId: { in: activeAssets.map((a) => a.id) }, readingDate: { gte: period.start, lte: period.end } },
      select: { assetId: true },
      distinct: ["assetId"],
    });
    const missing = activeAssets.length - withReading.length;
    if (missing > 0) {
      alerts.push({
        key: "readings-missing",
        category: "DATA",
        severity: "LOW",
        title: `${missing} vehicle${missing !== 1 ? "s" : ""} with no meter reading this month`,
        detail: "Missing readings force fuel-derived billing and weaken integrity checks.",
        href: isAdmin ? "/admin/data-quality" : "/readings",
      });
    }
  }

  // 5. Integrity findings (this month).
  const scan = await detectAnomalies({ from: period.start, to: period.end, projectId });
  if (scan.counts.high > 0 || scan.counts.medium > 0) {
    alerts.push({
      key: "integrity-findings",
      category: "INTEGRITY",
      severity: scan.counts.high > 0 ? "HIGH" : "MEDIUM",
      title: `${scan.counts.high + scan.counts.medium} fuel-integrity finding${scan.counts.high + scan.counts.medium !== 1 ? "s" : ""}`,
      detail: `${scan.counts.high} high / ${scan.counts.medium} medium severity this month.`,
      href: "/integrity",
    });
  }

  // 6. Service due / overdue.
  const svc = await getFleetServiceStatus({ projectId });
  if (svc.counts.overdue > 0 || svc.counts.dueSoon > 0) {
    alerts.push({
      key: "service-due",
      category: "SERVICE",
      severity: svc.counts.overdue > 0 ? "HIGH" : "MEDIUM",
      title: `${svc.counts.overdue} overdue · ${svc.counts.dueSoon} due-soon service${svc.counts.overdue + svc.counts.dueSoon !== 1 ? "s" : ""}`,
      detail: "Vehicles at or near their service interval (recorded or fuel-derived).",
      href: "/service",
    });
  }

  // 7. Admin-only: low bulk-tank balances.
  if (isAdmin) {
    const tanks = await getTankReconciliation();
    const low = tanks.filter((t) => t.lowBalance);
    if (low.length > 0) {
      alerts.push({
        key: "tanks-low",
        category: "TANK",
        severity: "MEDIUM",
        title: `${low.length} bulk tank${low.length !== 1 ? "s" : ""} low on fuel`,
        detail: `Below 10% capacity: ${low.map((t) => t.name).join(", ")}.`,
        href: "/admin/tanks",
      });
    }
  }

  // 8. Oil stock book (centrally managed — shown to admin/storekeeper, not a
  // site-scoped PM). Low stock, an overdue month-end count, and pending requests.
  if (!projectId) {
    const [products, balances] = await Promise.all([
      prisma.product.findMany({
        where: { active: true, reorderLevel: { not: null } },
        select: { id: true, name: true, reorderLevel: true },
      }),
      currentBalances(),
    ]);
    const low = products.filter((p) => (balances.get(p.id) ?? 0) <= (p.reorderLevel ?? 0));
    if (low.length > 0) {
      alerts.push({
        key: "oil-low",
        category: "STOCK",
        severity: "MEDIUM",
        title: `${low.length} oil/lubricant product${low.length !== 1 ? "s" : ""} low on stock`,
        detail: `At or below reorder level: ${low.slice(0, 5).map((p) => p.name).join(", ")}${low.length > 5 ? "…" : ""}.`,
        href: "/store/products",
      });
    }

    const now = new Date();
    const prevPeriod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const [prevCounts, productCount] = await Promise.all([
      prisma.stockCount.count({ where: { period: prevPeriod } }),
      prisma.product.count({ where: { active: true } }),
    ]);
    if (productCount > 0 && prevCounts === 0 && now.getUTCDate() > 7) {
      alerts.push({
        key: "stocktake-overdue",
        category: "STOCK",
        severity: "HIGH",
        title: `Stock take for ${prevPeriod} is overdue`,
        detail: "Record last month's physical count to keep the oil book reconciled.",
        href: "/store/stock-take",
      });
    }

    const pendingReqs = await prisma.requisition.count({ where: { status: "PENDING" } });
    if (pendingReqs > 0) {
      alerts.push({
        key: "reqs-pending",
        category: "STOCK",
        severity: "MEDIUM",
        title: `${pendingReqs} material requisition${pendingReqs !== 1 ? "s" : ""} pending`,
        detail: "Stock requests awaiting approval & dispatch.",
        href: "/store/requisitions",
      });
    }
  }

  alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return alerts;
}
