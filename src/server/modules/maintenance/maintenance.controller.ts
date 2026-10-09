// ============================================================================
// Phase 19 / Wave F: Equipment Maintenance Controller
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
import { MaintenanceService } from "./maintenance.service";
import type {
  CreateWorkOrderDto,
  AddLaborDto,
  AddPartConsumedDto,
  AddSubletDto,
  CompleteWorkOrderDto,
  CloseWorkOrderDto,
  WorkOrderStatus,
} from "./types";

@Controller("api/v3/maintenance")
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post("work-orders")
  async createWorkOrder(@Body() dto: CreateWorkOrderDto, @Req() req: any) {
    const actorId = req.user?.id || req.user?.email || "workshop-supervisor";
    return this.maintenanceService.createWorkOrder(dto, actorId);
  }

  @Post("work-orders/:id/labor")
  async addLabor(@Param("id") id: string, @Body() dto: AddLaborDto) {
    return this.maintenanceService.addLabor(id, dto);
  }

  @Post("work-orders/:id/parts")
  async addPartConsumed(@Param("id") id: string, @Body() dto: AddPartConsumedDto) {
    return this.maintenanceService.addPartConsumed(id, dto);
  }

  @Post("work-orders/:id/sublet")
  async addSublet(@Param("id") id: string, @Body() dto: AddSubletDto) {
    return this.maintenanceService.addSublet(id, dto);
  }

  @Post("work-orders/:id/complete")
  async completeWorkOrder(
    @Param("id") id: string,
    @Body() dto: CompleteWorkOrderDto,
    @Req() req: any
  ) {
    const actorId = req.user?.id || req.user?.email || "technician";
    return this.maintenanceService.completeWorkOrder(id, dto, actorId);
  }

  @Post("work-orders/:id/close")
  async closeWorkOrder(
    @Param("id") id: string,
    @Body() dto: CloseWorkOrderDto,
    @Req() req: any
  ) {
    const actorId = req.user?.id || req.user?.email || "supervisor";
    const actorRole = req.user?.role || "ADMIN";
    return this.maintenanceService.closeWorkOrder(id, actorId, actorRole, dto);
  }

  @Get("work-orders")
  async getWorkOrders(
    @Query("status") status?: WorkOrderStatus,
    @Query("assetId") assetId?: string,
    @Query("siteId") siteId?: string
  ) {
    return this.maintenanceService.getWorkOrders({ status, assetId, siteId });
  }

  @Get("work-orders/:id")
  async getWorkOrder(@Param("id") id: string) {
    return this.maintenanceService.getWorkOrder(id);
  }

  @Get("assets/:assetId/cost")
  async getAssetMaintenanceCost(@Param("assetId") assetId: string) {
    return this.maintenanceService.getAssetTotalMaintenanceCost(assetId);
  }
}
