// ============================================================================
// Phase 19 / Wave F: Multi-Site Inventory Module Definition
// Reference: Fuel-System-V3 Plan Section 24 & Wave F (ERP Expansion)
// ============================================================================

import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
