// ============================================================================
// NestJS Fuel Module: Domain Application Service
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Clean Architecture & DDD)
// Encapsulates single-writer transactional gateway and optimized query engines
// ============================================================================

import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from "@nestjs/common";
import { executeIssueFuel, IssueFuelResult } from "@/lib/commands/issue-fuel";
import { executeVoidFuelIssue, VoidFuelIssueResult } from "@/lib/commands/void-fuel-issue";
import { getFuelIssuesPaginated, type FuelIssueRowItem } from "@/lib/fuel/query-issues";
import { assetSearchClause } from "@/lib/fleet/asset-search";
import type { PaginatedResult } from "@/lib/pagination/types";
import type { Prisma } from "@prisma/client";
import type { IssueFuelDto, VoidFuelIssueDto } from "./dto/issue-fuel.dto";
import type { CommandContext } from "@/lib/commands/types";

export interface FuelIssuesQueryOptions {
  page?: string | number | null;
  limit?: string | number | null;
  where?: Prisma.FuelIssueWhereInput;
  search?: string | null;
  fuelKind?: string | null;
  site?: string | null;
  userRole?: string | null;
  userProjectId?: string | null;
  userBulkTankId?: string | null;
}

@Injectable()
export class FuelService {
  /**
   * Executes the authoritative single-writer IssueFuel command.
   */
  async issueFuel(dto: IssueFuelDto, ctx: CommandContext): Promise<IssueFuelResult> {
    const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
    const result = await executeIssueFuel(
      {
        assetIdOrCode: dto.assetIdOrCode,
        fuelKind: dto.fuelKind,
        litres: dto.litres,
        issueDate,
        meterReading: dto.meterReading,
        readingType: dto.readingType,
        bulkTankId: dto.bulkTankId,
        driverName: dto.driverName,
        fuelRequestId: dto.fuelRequestId,
        idempotencyKey: dto.idempotencyKey,
        source: dto.source,
      },
      ctx
    );

    if (!result.success) {
      if (result.code === "FORBIDDEN") throw new ForbiddenException(result.error);
      if (result.code === "NOT_FOUND") throw new NotFoundException(result.error);
      throw new BadRequestException(result.error);
    }

    return result.data;
  }

  /**
   * Executes the authoritative single-writer VoidFuelIssue command.
   */
  async voidFuelIssue(dto: VoidFuelIssueDto, ctx: CommandContext): Promise<VoidFuelIssueResult> {
    const result = await executeVoidFuelIssue(
      {
        issueId: dto.issueId,
        reason: dto.reason,
      },
      ctx
    );

    if (!result.success) {
      if (result.code === "FORBIDDEN") throw new ForbiddenException(result.error);
      if (result.code === "NOT_FOUND") throw new NotFoundException(result.error);
      throw new BadRequestException(result.error);
    }

    return result.data;
  }

  /**
   * Executes paginated, narrow-projection query for fuel issues.
   */
  async getIssuesPaginated(options: FuelIssuesQueryOptions = {}): Promise<PaginatedResult<FuelIssueRowItem>> {
    const where: Prisma.FuelIssueWhereInput = { ...(options.where || {}) };
    if (options.fuelKind) {
      where.fuelKind = options.fuelKind;
    }
    if (options.userBulkTankId) {
      where.bulkTankId = options.userBulkTankId;
    }
    if (options.search) {
      const searchClause = assetSearchClause(options.search);
      if (searchClause) where.asset = searchClause;
    }

    return getFuelIssuesPaginated({
      page: options.page,
      limit: options.limit,
      where,
    });
  }
}
