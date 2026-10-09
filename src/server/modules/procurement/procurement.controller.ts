// ============================================================================
// Phase 19 / Wave F: Procurement Module Controller
// Reference: Fuel-System-V3 Plan Section 24 (Phase 19) & Wave F (ERP Expansion)
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
import { ProcurementService } from "./procurement.service";
import type {
  CreatePurchaseOrderDto,
  ApprovePurchaseOrderDto,
  CreateGoodsReceiptDto,
  PurchaseOrderStatus,
} from "./types";

@Controller("api/v3/procurement")
export class ProcurementController {
  constructor(private readonly procurementService: ProcurementService) {}

  @Post("orders")
  async createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "system";
    return this.procurementService.createPurchaseOrder(dto, actorId);
  }

  @Post("orders/:id/approve")
  async approvePurchaseOrder(
    @Param("id") id: string,
    @Body() dto: ApprovePurchaseOrderDto,
    @Req() req: any
  ) {
    const actorId = req.user?.id || req.user?.email || "admin";
    const actorRole = req.user?.role || "ADMIN";
    return this.procurementService.approvePurchaseOrder(id, actorId, actorRole);
  }

  @Post("receipts")
  async recordGoodsReceipt(@Body() dto: CreateGoodsReceiptDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "site-manager";
    return this.procurementService.recordGoodsReceipt(dto, actorId);
  }

  @Get("orders/:id/match/:grnId")
  async performThreeWayMatch(
    @Param("id") id: string,
    @Param("grnId") grnId: string,
    @Query("tolerance") tolerance?: string
  ) {
    const tol = tolerance ? parseFloat(tolerance) : undefined;
    return this.procurementService.performThreeWayMatch(id, grnId, tol);
  }

  @Get("orders")
  async getPurchaseOrders(
    @Query("status") status?: PurchaseOrderStatus,
    @Query("siteId") siteId?: string
  ) {
    return this.procurementService.getPurchaseOrders({ status, siteId });
  }

  @Get("orders/:id")
  async getPurchaseOrder(@Param("id") id: string) {
    return this.procurementService.getPurchaseOrder(id);
  }

  @Get("receipts")
  async getGoodsReceipts(@Query("poId") poId?: string) {
    return this.procurementService.getGoodsReceipts(poId);
  }
}
