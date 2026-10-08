// ============================================================================
// NestJS Fleet Module: Module Definition
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Module } from "@nestjs/common";
import { FleetController } from "./fleet.controller";
import { FleetService } from "./fleet.service";
import { PrismaService } from "../../common/prisma.service";

@Module({
  controllers: [FleetController],
  providers: [FleetService, PrismaService],
  exports: [FleetService],
})
export class FleetModule {}
