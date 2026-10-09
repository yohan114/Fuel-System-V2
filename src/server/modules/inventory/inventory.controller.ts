// ============================================================================
// Phase 19 / Wave F: Multi-Site Inventory Controller
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
} from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import type {
  IssueStockToAssetDto,
  DispatchTransferDto,
  ReceiveTransferDto,
  AuditAdjustmentDto,
  TransferStatus,
} from "./types";

@Controller("api/v3/inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post("issue")
  async issueStockToAsset(@Body() dto: IssueStockToAssetDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "workshop-storekeeper";
    return this.inventoryService.issueStockToAsset(dto, actorId);
  }

  @Post("transfers/dispatch")
  async dispatchTransfer(@Body() dto: DispatchTransferDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "site-dispatcher";
    return this.inventoryService.dispatchTransfer(dto, actorId);
  }

  @Post("transfers/receive")
  async receiveTransfer(@Body() dto: ReceiveTransferDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "site-receiver";
    return this.inventoryService.receiveTransfer(dto, actorId);
  }

  @Post("audit")
  async auditAdjustStock(@Body() dto: AuditAdjustmentDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "auditor";
    const actorRole = req.user?.role || "ADMIN";
    return this.inventoryService.auditAdjustStock(dto, actorId, actorRole);
  }

  @Get("levels")
  async getStockLevels(@Query("locationId") locationId?: string) {
    return this.inventoryService.getStockLevels(locationId);
  }

  @Get("alerts")
  async checkReorderAlerts(@Query("locationId") locationId?: string) {
    return this.inventoryService.checkReorderAlerts(locationId);
  }

  @Get("transfers")
  async getTransfers(@Query("status") status?: TransferStatus) {
    return this.inventoryService.getTransfers(status);
  }

  @Get("ledger")
  async getLedgerEntries(
    @Query("itemCode") itemCode?: string,
    @Query("locationId") locationId?: string,
    @Query("assetId") assetId?: string
  ) {
    return this.inventoryService.getLedgerEntries({ itemCode, locationId, assetId });
  }
}
