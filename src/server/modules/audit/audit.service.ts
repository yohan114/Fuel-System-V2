// ============================================================================
// NestJS Audit Module: Domain Application Service
// Reference: Fuel-System-V3 Plan Section 3 & 18 (Immutable Append-Only Audit)
// ============================================================================

import { Injectable } from "@nestjs/common";
import { prisma } from "@/lib/db";

export interface CreateAuditEntryDto {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  metaJson?: string;
}

@Injectable()
export class AuditService {
  /**
   * Appends an immutable audit log entry.
   */
  async log(dto: CreateAuditEntryDto) {
    return prisma.auditLog.create({
      data: {
        actorId: dto.actorId,
        action: dto.action,
        entity: dto.entity,
        entityId: dto.entityId,
        summary: dto.summary,
        metaJson: dto.metaJson || "{}",
      },
    });
  }

  /**
   * Retrieves recent audit logs for an entity or actor.
   */
  async getRecentLogs(entity?: string, entityId?: string, limit = 50) {
    const where: any = {};
    if (entity) where.entity = entity;
    if (entityId) where.entityId = entityId;

    return prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        actorId: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        createdAt: true,
      },
    });
  }
}
