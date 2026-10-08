// ============================================================================
// NestJS Fleet Module: Domain Application Service
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Injectable, NotFoundException } from "@nestjs/common";
import { getFleetAssetsPaginated, GetFleetAssetsOptions, FleetAssetRowItem } from "@/lib/fleet/query-assets";
import { prisma } from "@/lib/db";
import { PaginatedResult } from "@/lib/pagination/types";

@Injectable()
export class FleetService {
  /**
   * Retrieves paginated fleet assets matching query criteria.
   */
  async getAssetsPaginated(options: GetFleetAssetsOptions): Promise<PaginatedResult<FleetAssetRowItem>> {
    return getFleetAssetsPaginated(options);
  }

  /**
   * Retrieves single asset specifications and recent fuel issues by code.
   */
  async getAssetByCode(code: string) {
    const asset = await prisma.asset.findFirst({
      where: { code: code.toUpperCase() },
      include: {
        category: true,
      },
    });

    if (!asset) {
      throw new NotFoundException(`Asset '${code}' was not found.`);
    }

    return asset;
  }
}
