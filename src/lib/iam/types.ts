// ============================================================================
// IAM-01: OIDC Identity Mapping & Session Policy Types (Master Plan Wave D)
// Defines standard OIDC token claims, mapped enterprise identities,
// role definitions, and session lifecycle contracts.
// ============================================================================

import type { Role } from "../roles";

export interface OidcTokenClaims {
  sub: string;                      // External subject ID (e.g. Keycloak UUID)
  preferred_username?: string;      // Username (e.g. "admin", "chamila")
  email?: string;                   // User email address
  email_verified?: boolean;
  name?: string;                    // Full display name
  realm_access?: {
    roles: string[];                // Keycloak realm roles
  };
  resource_access?: Record<string, { roles: string[] }>;
  roles?: string[];                 // Direct roles array (alternative OIDC format)
  tenant?: string;                  // Organization / tenant identifier
  site_id?: string;                 // Bound site/project ID
  tank_id?: string;                 // Bound bulk tank ID
  iss?: string;                     // Token issuer URL
  aud?: string | string[];          // Audience
  exp?: number;                     // Expiration time (epoch seconds)
  iat?: number;                     // Issued at (epoch seconds)
  jti?: string;                     // JWT unique identifier / session ID
}

export interface MappedEnterpriseIdentity {
  internalUserId: string;           // Local FuelSystem User.id (for AuditLog actor references)
  externalSubject: string;          // OIDC sub claim
  username: string;                 // Normalized username
  email: string | null;
  name: string;                     // Full display name
  role: Role;                       // Strict application role
  tenantId: string;                 // Tenant boundary
  projectId: string | null;         // Site scope
  bulkTankId: string | null;        // Tank scope
  active: boolean;                  // Account active status
}

export interface SessionPolicyConfig {
  defaultTenantId: string;
  allowedIssuers: string[];
  maxSessionLifetimeSeconds: number; // e.g. 7 days
  maxInactivitySeconds: number;      // e.g. 24 hours
}

export const DEFAULT_SESSION_POLICY: SessionPolicyConfig = {
  defaultTenantId: "enc-group",
  allowedIssuers: ["https://iam.fuelsystem.local/realms/fuelsystem", "http://localhost:8080/realms/fuelsystem"],
  maxSessionLifetimeSeconds: 7 * 24 * 60 * 60, // 7 days
  maxInactivitySeconds: 24 * 60 * 60,          // 24 hours
};
