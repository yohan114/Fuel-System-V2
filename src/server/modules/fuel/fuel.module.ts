// ============================================================================
// NestJS Fuel Module: Module Definition
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Module } from "@nestjs/common";
import { FuelController } from "./fuel.controller";
import { FuelService } from "./fuel.service";
import { PrismaService } from "../../common/prisma.service";

@Module({
  controllers: [FuelController],
  providers: [FuelService, PrismaService],
  exports: [FuelService],
})
export class FuelModule {}
