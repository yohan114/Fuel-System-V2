// ============================================================================
// NestJS Common: Tenant & Transaction Session Context Interceptor
// Reference: Fuel-System-V3 Plan Section 7, 11 (RLS and Tenant Context)
// ============================================================================

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { TenantSessionContext } from "@/lib/db/pg-context";

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Extract tenant and identity attributes from request/session
    const user = request?.user;
    const tenantContext: TenantSessionContext = {
      tenantId: request?.headers?.["x-tenant-id"] || user?.tenantId || null,
      userId: user?.id || request?.headers?.["x-user-id"] || null,
      userRole: user?.role || request?.headers?.["x-user-role"] || "USER",
      projectId: user?.projectId || request?.headers?.["x-project-id"] || null,
      bulkTankId: user?.bulkTankId || request?.headers?.["x-tank-id"] || null,
    };

    // Attach to request scope for downstream domain services
    request.tenantContext = tenantContext;

    return next.handle();
  }
}
