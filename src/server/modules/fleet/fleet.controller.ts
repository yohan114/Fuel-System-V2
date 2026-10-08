// ============================================================================
// NestJS Fleet Module: REST Controller
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Controller, Get, Param, Query, Req, UseInterceptors } from "@nestjs/common";
import { FleetService } from "./fleet.service";
import { TenantContextInterceptor } from "../../common/tenant-context.interceptor";

@Controller("api/v3/fleet")
@UseInterceptors(TenantContextInterceptor)
export class FleetController {
  constructor(private readonly fleetService: FleetService) {}

  @Get("assets")
  async getAssets(@Query() query: any, @Req() req: any) {
    const data = await this.fleetService.getAssetsPaginated({
      page: query.page,
      limit: query.limit,
      q: query.q || query.search,
      categoryCode: query.category,
      role: req?.user?.role || req?.tenantContext?.userRole,
      projectId: req?.user?.projectId || req?.tenantContext?.projectId,
    });

    return { success: true, ...data };
  }

  @Get("assets/:code")
  async getAssetByCode(@Param("code") code: string) {
    const asset = await this.fleetService.getAssetByCode(code);
    return { success: true, data: asset };
  }
}
