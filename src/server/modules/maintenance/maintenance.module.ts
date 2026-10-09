// ============================================================================
// Phase 19 / Wave F: Equipment Maintenance Module Definition
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import { Module } from "@nestjs/common";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceService } from "./maintenance.service";

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
