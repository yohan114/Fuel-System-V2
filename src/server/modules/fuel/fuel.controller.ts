// ============================================================================
// NestJS Fuel Module: REST Controller
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// Exposes API v3 endpoints for fuel operations
// ============================================================================

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseInterceptors,
} from "@nestjs/common";
import { FuelService } from "./fuel.service";
import type { IssueFuelDto, VoidFuelIssueDto } from "./dto/issue-fuel.dto";
import { TenantContextInterceptor } from "../../common/tenant-context.interceptor";
import type { CommandContext } from "@/lib/commands/types";

@Controller("api/v3/fuel")
@UseInterceptors(TenantContextInterceptor)
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Post("issue")
  async issueFuel(@Body() dto: IssueFuelDto, @Req() req: any) {
    const ctx: CommandContext = {
      actorId: req?.user?.id || req?.tenantContext?.userId || "system",
      actorName: req?.user?.name || "System Actor",
      role: req?.user?.role || req?.tenantContext?.userRole || "USER",
      projectId: req?.user?.projectId || req?.tenantContext?.projectId || null,
      bulkTankId: req?.user?.bulkTankId || req?.tenantContext?.bulkTankId || null,
    };

    const data = await this.fuelService.issueFuel(dto, ctx);
    return { success: true, data };
  }

  @Post("void")
  async voidFuelIssue(@Body() dto: VoidFuelIssueDto, @Req() req: any) {
    const ctx: CommandContext = {
      actorId: req?.user?.id || req?.tenantContext?.userId || "system",
      actorName: req?.user?.name || "System Actor",
      role: req?.user?.role || req?.tenantContext?.userRole || "ADMIN",
      projectId: req?.user?.projectId || req?.tenantContext?.projectId || null,
      bulkTankId: req?.user?.bulkTankId || req?.tenantContext?.bulkTankId || null,
    };

    const data = await this.fuelService.voidFuelIssue(dto, ctx);
    return { success: true, data };
  }

  @Get("issues")
  async getIssues(@Query() query: any, @Req() req: any) {
    const data = await this.fuelService.getIssuesPaginated({
      page: query.page,
      limit: query.limit,
      search: query.q || query.search,
      fuelKind: query.fuelKind,
      site: query.site,
      userRole: req?.user?.role || req?.tenantContext?.userRole,
      userProjectId: req?.user?.projectId || req?.tenantContext?.projectId,
      userBulkTankId: req?.user?.bulkTankId || req?.tenantContext?.bulkTankId,
    });

    return { success: true, ...data };
  }
}
