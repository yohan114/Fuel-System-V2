// ============================================================================
// IAM-01: OIDC Identity Mapping & Session Policy Test Suite
// Verifies:
// 1. External OIDC token claim extraction & canonical role mapping.
// 2. Preservation of historical internal User UUIDs for AuditLog continuity.
// 3. Multi-tenant boundary enforcement (cross-tenant rejection).
// 4. Token expiration & maximum session lifetime boundaries.
// 5. Server-side session revocation & immediate user invalidation.
// 6. Inactive/disabled account rejection.
// 7. Role scope enforcement for OIDC authenticated API requests.
// ============================================================================

import { describe, expect, it, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";
import {
  extractRoleFromClaims,
  mapOidcClaimsToIdentity,
} from "../src/lib/iam/oidc-mapper";
import {
  SessionRevocationManager,
  authenticateOidcToken,
  validateTokenLifetime,
} from "../src/lib/iam/session-policy";
import { requireApi } from "../src/lib/api/auth";
import type { OidcTokenClaims } from "../src/lib/iam/types";

// Hoisted mock state populated with real baseline user profiles from rehearsal
const { mockPrisma, testUsers } = vi.hoisted(() => {
  const testUsers = [
    {
      id: "d3a40965-d1a9-4fc0-b047-66adaeb4c9dc",
      username: "admin",
      email: "admin@fuelsystem.lk",
      name: "Administrator",
      role: "ADMIN",
      active: true,
      projectId: null,
      bulkTankId: null,
    },
    {
      id: "156d5641-e6ff-4bb6-8016-4e16971c9cdd",
      username: "chamila",
      email: null,
      name: "Chamila Welarathne",
      role: "WORKSHOP",
      active: true,
      projectId: null,
      bulkTankId: "f75d97fb-125c-4e56-bdd5-9b5ff21189d7",
    },
    {
      id: "058c7f97-1370-463b-8819-d03606705dfd",
      username: "ishadi",
      email: null,
      name: "Ishadi",
      role: "SITE_PUMP",
      active: true,
      projectId: "a7efb755-f304-4eca-8e4d-dbd80fff1fea",
      bulkTankId: "c2f27189-9ff3-4804-b441-2e3599e6e97b",
    },
    {
      id: "disabled-user-uuid",
      username: "disabled_user",
      email: "disabled@fuelsystem.lk",
      name: "Disabled Employee",
      role: "USER",
      active: false, // Inactive user
      projectId: null,
      bulkTankId: null,
    },
  ];

  const mockPrisma = {
    user: {
      findFirst: vi.fn().mockImplementation((args: any) => {
        const orConditions = args?.where?.OR || [];
        for (const cond of orConditions) {
          if (cond.username) {
            const found = testUsers.find((u) => u.username === cond.username);
            if (found) return Promise.resolve({ ...found });
          }
          if (cond.email) {
            const found = testUsers.find((u) => u.email === cond.email);
            if (found) return Promise.resolve({ ...found });
          }
        }
        return Promise.resolve(null);
      }),
      findUnique: vi.fn().mockImplementation((args: any) => {
        if (args?.where?.id) {
          const found = testUsers.find((u) => u.id === args.where.id);
          return Promise.resolve(found ? { ...found } : null);
        }
        return Promise.resolve(null);
      }),
    },
    apiKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  return { mockPrisma, testUsers };
});

vi.mock("../src/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

describe("IAM-01: OIDC Identity Mapping & Session Policy", () => {
  let revocationManager: SessionRevocationManager;

  beforeEach(() => {
    revocationManager = new SessionRevocationManager();
  });

  describe("1. OIDC Role Extraction & Normalization", () => {
    it("extracts and prioritizes roles from Keycloak realm_access", () => {
      const claims: OidcTokenClaims = {
        sub: "kc-usr-01",
        realm_access: { roles: ["offline_access", "ADMIN", "default-roles-fuelsystem"] },
      };
      expect(extractRoleFromClaims(claims)).toBe("ADMIN");
    });

    it("extracts roles from resource_access or direct roles array", () => {
      const claims1: OidcTokenClaims = {
        sub: "kc-usr-02",
        resource_access: { fuelsystem: { roles: ["WORKSHOP"] } },
      };
      expect(extractRoleFromClaims(claims1)).toBe("WORKSHOP");

      const claims2: OidcTokenClaims = {
        sub: "kc-usr-03",
        roles: ["SITE_PUMP"],
      };
      expect(extractRoleFromClaims(claims2)).toBe("SITE_PUMP");
    });

    it("defaults unknown or missing roles to least-privilege USER", () => {
      const claims: OidcTokenClaims = {
        sub: "kc-usr-04",
        roles: ["viewer", "guest"],
      };
      expect(extractRoleFromClaims(claims)).toBe("USER");
    });
  });

  describe("2. Historical User Identity Mapping & Audit Continuity", () => {
    it("maps external OIDC claims to existing local admin user and preserves local UUID", async () => {
      const claims: OidcTokenClaims = {
        sub: "ext-kc-sub-9999",
        preferred_username: "admin",
        email: "admin@fuelsystem.lk",
        name: "Enterprise Admin",
        realm_access: { roles: ["ADMIN"] },
      };

      const identity = await mapOidcClaimsToIdentity(claims);

      // Must preserve the known historical UUID (d3a40965-...) for AuditLog actor integrity
      expect(identity.internalUserId).toBe("d3a40965-d1a9-4fc0-b047-66adaeb4c9dc");
      expect(identity.username).toBe("admin");
      expect(identity.role).toBe("ADMIN");
      expect(identity.active).toBe(true);
      expect(identity.externalSubject).toBe("ext-kc-sub-9999");
    });

    it("maps workshop user and preserves local tank/site bounds", async () => {
      const claims: OidcTokenClaims = {
        sub: "ext-kc-sub-chamila",
        preferred_username: "chamila",
        roles: ["WORKSHOP"],
      };

      const identity = await mapOidcClaimsToIdentity(claims);

      expect(identity.internalUserId).toBe("156d5641-e6ff-4bb6-8016-4e16971c9cdd");
      expect(identity.username).toBe("chamila");
      expect(identity.role).toBe("WORKSHOP");
      expect(identity.bulkTankId).toBe("f75d97fb-125c-4e56-bdd5-9b5ff21189d7");
    });

    it("maps site pump user and preserves site binding", async () => {
      const claims: OidcTokenClaims = {
        sub: "ext-kc-sub-ishadi",
        preferred_username: "ishadi",
        roles: ["SITE_PUMP"],
      };

      const identity = await mapOidcClaimsToIdentity(claims);

      expect(identity.internalUserId).toBe("058c7f97-1370-463b-8819-d03606705dfd");
      expect(identity.username).toBe("ishadi");
      expect(identity.role).toBe("SITE_PUMP");
      expect(identity.projectId).toBe("a7efb755-f304-4eca-8e4d-dbd80fff1fea");
    });
  });

  describe("3. Multi-Tenant Boundary Enforcement", () => {
    it("accepts tokens matching the authorized enterprise tenant", async () => {
      const claims: OidcTokenClaims = {
        sub: "kc-usr-tenant-ok",
        preferred_username: "admin",
        tenant: "enc-group",
      };

      const identity = await mapOidcClaimsToIdentity(claims);
      expect(identity.tenantId).toBe("enc-group");
    });

    it("strictly rejects tokens originating from foreign unauthorized tenants", async () => {
      const claims: OidcTokenClaims = {
        sub: "kc-usr-attacker",
        preferred_username: "admin",
        tenant: "foreign-tenant-xyz",
      };

      await expect(mapOidcClaimsToIdentity(claims)).rejects.toThrow("CROSS_TENANT_ACCESS_DENIED");
    });
  });

  describe("4. Session Lifetime & Expiration Rules", () => {
    it("rejects tokens that have expired past their exp timestamp", () => {
      const expiredClaims: OidcTokenClaims = {
        sub: "usr-exp",
        exp: 1000, // Year 1970
      };

      expect(() => validateTokenLifetime(expiredClaims)).toThrow("TOKEN_EXPIRED");
    });

    it("rejects tokens exceeding maximum absolute session lifetime (7 days)", () => {
      const now = 2_000_000_000;
      const oldIssuedAt = now - (8 * 24 * 60 * 60); // 8 days ago
      const claims: OidcTokenClaims = {
        sub: "usr-too-old",
        iat: oldIssuedAt,
        exp: now + 3600, // exp is valid, but iat exceeds maximum lifetime
      };

      expect(() => validateTokenLifetime(claims, undefined, now)).toThrow("SESSION_MAX_LIFETIME_EXCEEDED");
    });
  });

  describe("5. Centralized Session Revocation & Inactive User Policy", () => {
    it("immediately invalidates active sessions when a user is revoked", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const claims: OidcTokenClaims = {
        sub: "kc-admin-rev",
        preferred_username: "admin",
        iat: nowSeconds - 100,
        exp: nowSeconds + 3600,
      };

      // 1. Before revocation: authentication succeeds
      const idBefore = await authenticateOidcToken(claims, { revocationManager });
      expect(idBefore.username).toBe("admin");

      // 2. Administrator revokes user
      revocationManager.revokeUser("admin", "Security audit revocation");

      // 3. Subsequent authentication attempt fails immediately
      await expect(
        authenticateOidcToken(claims, { revocationManager })
      ).rejects.toThrow("SESSION_REVOKED");
    });

    it("supports specific token ID (jti) revocation", async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const token1: OidcTokenClaims = {
        sub: "kc-admin-jti",
        preferred_username: "admin",
        jti: "session-uuid-1",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      };
      const token2: OidcTokenClaims = {
        sub: "kc-admin-jti",
        preferred_username: "admin",
        jti: "session-uuid-2",
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      };

      // Revoke token1 specifically
      revocationManager.revokeSession("session-uuid-1", "Logged out from device A");

      await expect(authenticateOidcToken(token1, { revocationManager })).rejects.toThrow("SESSION_REVOKED");
      // token2 on device B remains valid
      const id2 = await authenticateOidcToken(token2, { revocationManager });
      expect(id2.username).toBe("admin");
    });

    it("rejects inactive/disabled user accounts even with valid tokens", async () => {
      const disabledClaims: OidcTokenClaims = {
        sub: "usr-disabled-sub",
        preferred_username: "disabled_user",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };

      await expect(
        authenticateOidcToken(disabledClaims, { revocationManager })
      ).rejects.toThrow("ACCOUNT_DISABLED");
    });
  });

  describe("6. API Gateway requireApi() OIDC Integration", () => {
    it("authenticates unencrypted OIDC JWT bearer tokens and enforces role scopes", async () => {
      // Create a valid OIDC JWT token for workshop user
      const workshopToken = await new SignJWT({
        sub: "kc-chamila-uuid",
        preferred_username: "chamila",
        roles: ["WORKSHOP"],
        tenant: "enc-group",
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode("secret-dummy-signing-key")); // Unverified external JWT

      // 1. Workshop user allowed to write fuel
      const req1 = new Request("http://localhost:3300/api/v1/fuel/issues", {
        headers: { Authorization: `Bearer ${workshopToken}` },
      });
      const authResult1 = await requireApi(req1, "write:fuel");
      expect("auth" in authResult1).toBe(true);
      if ("auth" in authResult1) {
        expect(authResult1.auth.role).toBe("WORKSHOP");
        expect(authResult1.auth.user?.username).toBe("chamila");
      }

      // 2. Workshop user strictly denied from reading commercial billing (Master Plan SEC-02)
      const req2 = new Request("http://localhost:3300/api/v1/bills", {
        headers: { Authorization: `Bearer ${workshopToken}` },
      });
      const authResult2 = await requireApi(req2, "read:billing");
      expect("error" in authResult2).toBe(true);
      if ("error" in authResult2) {
        expect((authResult2.error as any).status).toBe(403);
      }
    });
  });
});
