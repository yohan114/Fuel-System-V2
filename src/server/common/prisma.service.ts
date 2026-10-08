// ============================================================================
// NestJS Common: Injectable Prisma Database Service
// Reference: Fuel-System-V3 Plan Section 3 & 11 (Modular Monolith)
// ============================================================================

import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  public readonly client: PrismaClient = prisma;

  async onModuleInit() {
    // Database connection already established and managed via Prisma adapter
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
