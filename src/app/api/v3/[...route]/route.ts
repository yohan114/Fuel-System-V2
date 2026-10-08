// ============================================================================
// Next.js -> NestJS V3 Modular Monolith API Gateway Bridge
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// Routes /api/v3/* requests to NestJS domain services with OIDC/RBAC auth
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireApi } from "@/lib/api/auth";
import { checkRateLimit, formatRateLimitHeaders } from "@/lib/cache/rate-limiter";
import {
  getDomainService,
  FuelService,
  FleetService,
  BillingService,
  AuditService,
} from "@/server/bootstrap";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ route: string[] }> }
) {
  const { route } = await context.params;
  const pathStr = route.join("/");
  const url = new URL(req.url);

  // Authenticate caller (API Key or OIDC JWT Bearer)
  const authResult = await requireApi(req);
  if ("error" in authResult) return authResult.error;
  const user = authResult.auth.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized user" }, { status: 401 });
  }

  // Rate limit protection: 300 requests per minute
  const rl = await checkRateLimit(`get:${user.id}`, 300, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded. Please wait before retrying." },
      { status: 429, headers: formatRateLimitHeaders(rl) }
    );
  }

  try {
    // 1. Fuel Routes
    if (pathStr === "fuel/issues") {
      const fuelService = await getDomainService<FuelService>(FuelService);
      const data = await fuelService.getIssuesPaginated({
        page: url.searchParams.get("page"),
        limit: url.searchParams.get("limit"),
        search: url.searchParams.get("q") || url.searchParams.get("search") || undefined,
        fuelKind: url.searchParams.get("fuelKind") || undefined,
        site: url.searchParams.get("site") || undefined,
        userRole: user.role,
        userProjectId: user.projectId,
      });
      return NextResponse.json({ success: true, ...data });
    }

    // 2. Fleet Routes
    if (pathStr === "fleet/assets") {
      const fleetService = await getDomainService<FleetService>(FleetService);
      const data = await fleetService.getAssetsPaginated({
        page: url.searchParams.get("page"),
        limit: url.searchParams.get("limit"),
        q: url.searchParams.get("q") || undefined,
        categoryCode: url.searchParams.get("category") || undefined,
        role: user.role,
        projectId: user.projectId,
      });
      return NextResponse.json({ success: true, ...data });
    }

    if (pathStr.startsWith("fleet/assets/")) {
      const code = route[2];
      const fleetService = await getDomainService<FleetService>(FleetService);
      const data = await fleetService.getAssetByCode(code);
      return NextResponse.json({ success: true, data });
    }

    // 3. Billing Routes
    if (pathStr === "billing/invoices") {
      const billingService = await getDomainService<BillingService>(BillingService);
      const periodKey = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
      const data = await billingService.getInvoicesPaginated({
        periodKey,
        projectId: url.searchParams.get("site"),
        status: url.searchParams.get("status"),
        page: url.searchParams.get("page") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      });
      return NextResponse.json({ success: true, ...data });
    }

    if (pathStr.startsWith("billing/jobs/")) {
      const jobId = route[2];
      const billingService = await getDomainService<BillingService>(BillingService);
      const data = await billingService.getBillingJobStatus(jobId);
      return NextResponse.json({ success: true, data });
    }

    // 4. Audit Routes
    if (pathStr === "audit/logs") {
      const auditService = await getDomainService<AuditService>(AuditService);
      const data = await auditService.getRecentLogs(
        url.searchParams.get("entity") || undefined,
        url.searchParams.get("entityId") || undefined
      );
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json(
      { success: false, error: `Endpoint '/api/v3/${pathStr}' not found` },
      { status: 404 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: err.status || 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ route: string[] }> }
) {
  const { route } = await context.params;
  const pathStr = route.join("/");

  // Authenticate caller (Requires write scope)
  const authResult = await requireApi(req);
  if ("error" in authResult) return authResult.error;
  const user = authResult.auth.user;
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized user" }, { status: 401 });
  }

  // Rate limit protection: 120 write requests per minute
  const rl = await checkRateLimit(`post:${user.id}`, 120, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: "Rate limit exceeded for write operations. Please wait before retrying." },
      { status: 429, headers: formatRateLimitHeaders(rl) }
    );
  }

  const body = await req.json().catch(() => ({}));

  try {
    // 1. Fuel Routes
    if (pathStr === "fuel/issue") {
      const fuelService = await getDomainService<FuelService>(FuelService);
      const data = await fuelService.issueFuel(body, {
        actorId: user.id,
        actorName: user.name,
        role: user.role,
        projectId: user.projectId,
      });
      return NextResponse.json({ success: true, data });
    }

    if (pathStr === "fuel/void") {
      const fuelService = await getDomainService<FuelService>(FuelService);
      const data = await fuelService.voidFuelIssue(body, {
        actorId: user.id,
        actorName: user.name,
        role: user.role,
        projectId: user.projectId,
      });
      return NextResponse.json({ success: true, data });
    }

    // 2. Billing Routes
    if (pathStr === "billing/finalize") {
      const billingService = await getDomainService<BillingService>(BillingService);
      const data = await billingService.bulkFinalizeBills(body.billIds || []);
      return NextResponse.json({ success: true, data });
    }

    if (pathStr === "billing/pay") {
      const billingService = await getDomainService<BillingService>(BillingService);
      const data = await billingService.bulkMarkPaid(body.billIds || []);
      return NextResponse.json({ success: true, data });
    }

    if (pathStr === "billing/basis") {
      const billingService = await getDomainService<BillingService>(BillingService);
      const data = await billingService.bulkSetBasis(body.billIds || [], body.basis);
      return NextResponse.json({ success: true, data });
    }

    if (pathStr === "billing/jobs/monthly") {
      const billingService = await getDomainService<BillingService>(BillingService);
      const data = await billingService.enqueueMonthlyBilling({
        year: Number(body.year),
        month: Number(body.month),
        assetIds: body.assetIds,
        regenerate: Boolean(body.regenerate),
        projectId: body.projectId || null,
        basis: body.basis,
      });
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json(
      { success: false, error: `Endpoint '/api/v3/${pathStr}' not found` },
      { status: 404 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: err.status || 500 }
    );
  }
}
