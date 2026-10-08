// ============================================================================
// IAM-01: OIDC Identity Mapping Engine (Master Plan Section 7)
// Maps external OIDC provider claims to internal FuelSystem enterprise identities,
// strictly preserving historical audit actor references (AuditLog.actorId) and
// enforcing tenant and resource-level role boundaries.
// ============================================================================

import { prisma } from "../db";
import type { Role } from "../roles";
import {
  DEFAULT_SESSION_POLICY,
  type MappedEnterpriseIdentity,
  type OidcTokenClaims,
  type SessionPolicyConfig,
} from "./types";

const VALID_ROLES = new Set<Role>(["ADMIN", "ALLOCATOR", "WORKSHOP", "SITE_PUMP", "USER"]);

/**
 * Extracts and maps roles from OIDC claims to the strict FuelSystem role domain.
 */
export function extractRoleFromClaims(claims: OidcTokenClaims): Role {
  const candidates: string[] = [];

  // Keycloak realm_access.roles
  if (claims.realm_access?.roles && Array.isArray(claims.realm_access.roles)) {
    candidates.push(...claims.realm_access.roles);
  }

  // Keycloak resource_access.fuelsystem.roles
  if (claims.resource_access?.fuelsystem?.roles) {
    candidates.push(...claims.resource_access.fuelsystem.roles);
  }

  // Direct claims.roles
  if (claims.roles && Array.isArray(claims.roles)) {
    candidates.push(...claims.roles);
  }

  // Find highest privilege matching role
  // Priority: ADMIN > ALLOCATOR > WORKSHOP > SITE_PUMP > USER
  const normalized = candidates.map((r) => r.toUpperCase());

  if (normalized.includes("ADMIN")) return "ADMIN";
  if (normalized.includes("ALLOCATOR")) return "ALLOCATOR";
  if (normalized.includes("WORKSHOP")) return "WORKSHOP";
  if (normalized.includes("SITE_PUMP")) return "SITE_PUMP";
  if (normalized.includes("USER")) return "USER";

  return "USER"; // Default least-privilege role
}

/**
 * Maps OIDC token claims to an internal FuelSystem identity.
 * Looks up existing user by preferred_username or email to preserve stable local UUIDs
 * for AuditLog and operational records.
 */
export async function mapOidcClaimsToIdentity(
  claims: OidcTokenClaims,
  config: SessionPolicyConfig = DEFAULT_SESSION_POLICY
): Promise<MappedEnterpriseIdentity> {
  const username = claims.preferred_username?.toLowerCase() || claims.sub;
  const email = claims.email?.toLowerCase() || null;
  const roleFromToken = extractRoleFromClaims(claims);
  const tenantId = claims.tenant || config.defaultTenantId;

  // Tenant Boundary Check: verify tenant isolation
  if (claims.tenant && claims.tenant !== config.defaultTenantId) {
    throw new Error(`CROSS_TENANT_ACCESS_DENIED: Tenant '${claims.tenant}' is not permitted.`);
  }

  // Look up local user to preserve database foreign key continuity
  let localUser = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        ...(email ? [{ email }] : []),
      ],
    },
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      active: true,
      projectId: true,
      bulkTankId: true,
    },
  });

  if (localUser) {
    // If user account is deactivated in the local database, respect inactivation
    return {
      internalUserId: localUser.id,
      externalSubject: claims.sub,
      username: localUser.username,
      email: localUser.email,
      name: claims.name || localUser.name,
      role: (localUser.role as Role) || roleFromToken,
      tenantId,
      projectId: claims.site_id || localUser.projectId,
      bulkTankId: claims.tank_id || localUser.bulkTankId,
      active: localUser.active,
    };
  }

  // Fallback for new / external-only accounts: deterministic mapping
  return {
    internalUserId: claims.sub,
    externalSubject: claims.sub,
    username,
    email,
    name: claims.name || username,
    role: roleFromToken,
    tenantId,
    projectId: claims.site_id || null,
    bulkTankId: claims.tank_id || null,
    active: true,
  };
}
