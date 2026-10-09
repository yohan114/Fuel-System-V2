// ============================================================================
// Phase 19 / Wave F: External Integration & GL Export Module Definition
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import { Module } from "@nestjs/common";
import { GLExportController } from "./gl-export.controller";
import { GLExportService } from "./gl-export.service";

@Module({
  controllers: [GLExportController],
  providers: [GLExportService],
  exports: [GLExportService],
})
export class IntegrationModule {}
