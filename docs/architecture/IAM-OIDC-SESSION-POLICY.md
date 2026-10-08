# OpenID Connect (OIDC) Identity Mapping & Session Policy (IAM-01)

**System:** Fuel-System-V2 Enterprise ERP  
**Module:** Enterprise Identity & Access Management (`src/lib/iam/`, `apps/api/`)  
**Standard:** OpenID Connect Core 1.0 / OAuth 2.0 Bearer Profile  
**Revision:** Wave D — Backend Replacement

---

## 1. Executive Summary

As part of the Wave D Backend Replacement (**IAM-01**), this document establishes the identity mapping engine and session policy governing authentication between enterprise Identity Providers (such as Keycloak, Microsoft Entra ID, or Okta) and the Fuel-System-V2 modular monolith.

The design delivers three critical guarantees:
1. **Audit Provenance Continuity**: External identities map deterministically to existing internal `User` UUIDs, ensuring that historical audit logs (`AuditLog.actorId`), fuel issues, and billing approvals remain unbroken.
2. **Strict Multi-Tenant & Role Isolation**: External realm roles are mapped to canonical FuelSystem application roles with strict least-privilege defaults and cross-tenant boundary validation.
3. **Centralized Session Invalidation**: Application sessions support immediate server-side revocation upon user disabling, preventing orphaned active JWT tokens from retaining system access.

---

## 2. Identity Mapping Architecture

```
[ Enterprise Identity Provider (Keycloak / Entra ID) ]
                          │
                          ▼ (Signed Bearer JWT)
┌────────────────────────────────────────────────────────┐
│ OIDC Claims:                                           │
│ - sub: "kc-usr-0042-uuid"                              │
│ - preferred_username: "chamila"                       │
│ - realm_access.roles: ["WORKSHOP"]                     │
│ - tenant: "enc-group"                                  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼ mapOidcClaimsToIdentity()
┌────────────────────────────────────────────────────────┐
│ Mapped Enterprise Identity:                            │
│ - internalUserId: "156d5641-e6ff-..." (Existing UUID)  │
│ - username: "chamila"                                  │
│ - role: "WORKSHOP"                                     │
│ - tenantId: "enc-group"                                │
│ - active: true                                         │
└────────────────────────────────────────────────────────┘
```

### Role Mapping Resolution:
External role tokens are matched against the canonical application hierarchy:
- `ADMIN`: Full administrative authority across all sites, rates, users, and billing issuance.
- `ALLOCATOR`: Unrestricted vehicle assignment management.
- `WORKSHOP`: Central workshop pump operations across all fleet machines; **strictly excluded** from commercial rates and financial invoices.
- `SITE_PUMP`: Physical dispensing at assigned site tank; restricted to own-site and own-tank logs.
- `USER`: Default site PM login.

---

## 3. Session Policy & Revocation Engine

Master Plan Section 7 mandates:
> *"Do not assume changing the identity provider automatically invalidates existing application sessions."*

To satisfy this, the ERP implements [`SessionRevocationManager`](file:///C:/Users/HP/.gemini/antigravity/worktrees/fuelsystem/list_fuel_system_branches/src/lib/iam/session-policy.ts):
- **User Revocation (`revokeUser`)**: Sets an immediate revocation timestamp for a user. Any token issued prior to this timestamp is instantly rejected with `401 Unauthorized (SESSION_REVOKED)`.
- **Token Invalidation (`revokeSession`)**: Explicitly blocks individual session identifiers (`jti`).
- **Account Disabling Enforcement**: When a local user account has `active = false`, bearer tokens are rejected immediately with `401 Unauthorized (ACCOUNT_DISABLED)`.

---

## 4. API & Gateway Integration

API routes authenticate via [`requireApi()`](file:///C:/Users/HP/.gemini/antigravity/worktrees/fuelsystem/list_fuel_system_branches/src/lib/api/auth.ts), supporting multi-scheme authentication:
1. **OIDC Bearer Token**: `Authorization: Bearer <oidc_jwt>`
2. **API Key**: `Authorization: Bearer fs_live_<key>`
3. **Session Cookie**: Next.js HTTP-only session cookie for interactive browser users.
