// ============================================================================
// NestJS Billing Module: REST Controller
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Controller, Get, Post, Body, Query, Req, UseInterceptors } from "@nestjs/common";
import { BillingService } from "./billing.service";
import { TenantContextInterceptor } from "../../common/tenant-context.interceptor";
import { currentMonthPeriod } from "@/lib/billing/period";

@Controller("api/v3/billing")
@UseInterceptors(TenantContextInterceptor)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get("invoices")
  async getInvoices(@Query() query: any, @Req() req: any) {
    const cur = currentMonthPeriod();
    const periodKey = query.month || cur.periodKey;

    const data = await this.billingService.getInvoicesPaginated({
      periodKey,
      projectId: query.site || req?.user?.projectId || req?.tenantContext?.projectId,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });

    return { success: true, ...data };
  }

  @Post("finalize")
  async finalize(@Body() body: { billIds: string[] }) {
    const data = await this.billingService.bulkFinalizeBills(body.billIds);
    return { success: true, data };
  }

  @Post("pay")
  async markPaid(@Body() body: { billIds: string[] }) {
    const data = await this.billingService.bulkMarkPaid(body.billIds);
    return { success: true, data };
  }

  @Post("basis")
  async setBasis(@Body() body: { billIds: string[]; basis: string }) {
    const data = await this.billingService.bulkSetBasis(body.billIds, body.basis);
    return { success: true, data };
  }
}
