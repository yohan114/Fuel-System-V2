// ============================================================================
// NestJS Root Application Module: Modular Monolith Container
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// Orchestrates Domain Modules: Fuel, Fleet, Billing, Audit
// ============================================================================

import { Module } from "@nestjs/common";
import { FuelModule } from "./modules/fuel/fuel.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { BillingModule } from "./modules/billing/billing.module";
import { AuditModule } from "./modules/audit/audit.module";
import { ProcurementModule } from "./modules/procurement/procurement.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { MaintenanceModule } from "./modules/maintenance/maintenance.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { IntegrationModule } from "./modules/integration/integration.module";
import { PrismaService } from "./common/prisma.service";

@Module({
  imports: [
    FuelModule,
    FleetModule,
    BillingModule,
    AuditModule,
    ProcurementModule,
    InventoryModule,
    MaintenanceModule,
    FinanceModule,
    IntegrationModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
