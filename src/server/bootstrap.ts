// ============================================================================
// NestJS Application Context Bootstrap & Service Factory
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { INestApplicationContext } from "@nestjs/common";
import { AppModule } from "./app.module";
import { FuelService } from "./modules/fuel/fuel.service";
import { FleetService } from "./modules/fleet/fleet.service";
import { BillingService } from "./modules/billing/billing.service";
import { AuditService } from "./modules/audit/audit.service";

let cachedAppContext: INestApplicationContext | null = null;

/**
 * Initializes or returns the singleton NestJS application context.
 */
export async function getAppContext(): Promise<INestApplicationContext> {
  if (!cachedAppContext) {
    cachedAppContext = await NestFactory.createApplicationContext(AppModule, {
      logger: false, // Suppress console banner in serverless/test environments
    });
  }
  return cachedAppContext;
}

/**
 * Resolves a domain service instance from the NestJS DI container.
 */
export async function getDomainService<T>(serviceClass: any): Promise<T> {
  const ctx = await getAppContext();
  return ctx.get<T>(serviceClass);
}

export { FuelService, FleetService, BillingService, AuditService };
