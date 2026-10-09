// ============================================================================
// Phase 19 / Wave F: Finance & Receivables Controller
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import { FinanceService } from "./finance.service";
import type {
  CreateCustomerAccountDto,
  PostARInvoiceDto,
  AllocatePaymentDto,
  SetCreditHoldDto,
} from "./types";

@Controller("api/v3/finance")
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Post("customers")
  async createCustomerAccount(@Body() dto: CreateCustomerAccountDto) {
    return this.financeService.createCustomerAccount(dto);
  }

  @Get("customers/:id/credit-check")
  async checkCreditApproval(
    @Param("id") id: string,
    @Query("amount") amount: string
  ) {
    const amountCents = parseInt(amount, 10) || 0;
    return this.financeService.checkCreditApproval(id, amountCents);
  }

  @Post("customers/:id/credit-hold")
  async setCreditHold(
    @Param("id") id: string,
    @Body() dto: SetCreditHoldDto,
    @Req() req: any
  ) {
    const actorId = req.user?.id || req.user?.email || "credit-controller";
    const actorRole = req.user?.role || "ADMIN";
    return this.financeService.setCreditHold({ ...dto, customerId: id }, actorId, actorRole);
  }

  @Post("invoices")
  async postARInvoice(@Body() dto: PostARInvoiceDto) {
    return this.financeService.postARInvoice(dto);
  }

  @Post("payments")
  async allocatePayment(@Body() dto: AllocatePaymentDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "cashier";
    return this.financeService.allocatePayment(dto, actorId);
  }

  @Get("aging")
  async generateAgingReport(@Query("asOfDate") asOfDate?: string) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    return this.financeService.generateAgingReport(date);
  }

  @Get("customers")
  async getCustomerAccounts() {
    return this.financeService.getCustomerAccounts();
  }

  @Get("invoices")
  async getARInvoices(@Query("customerId") customerId?: string) {
    return this.financeService.getARInvoices(customerId);
  }
}
