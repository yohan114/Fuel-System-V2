// ============================================================================
// NestJS Audit Module: Module Definition
// Reference: Fuel-System-V3 Plan Section 3 & 18 (Immutable Audit)
// ============================================================================

import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { PrismaService } from "../../common/prisma.service";

@Module({
  providers: [AuditService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
