// ============================================================================
// Phase 19 / Wave F: Procurement Module Definition
// Reference: Fuel-System-V3 Plan Section 24 (Phase 19) & Wave F (ERP Expansion)
// ============================================================================

import { Module } from "@nestjs/common";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";

@Module({
  controllers: [ProcurementController],
  providers: [ProcurementService],
  exports: [ProcurementService],
})
export class ProcurementModule {}
