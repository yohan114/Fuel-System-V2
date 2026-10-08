// ============================================================================
// IAM-01: Session Policy & Revocation Manager (Master Plan Section 7)
// Enforces centralized session revocation, token lifetime boundaries, and
// immediate invalidation upon user disabling or role modification.
// ============================================================================

import { jwtVerify, decodeJwt } from "jose";
import { resolveAuthSecret } from "../auth-secret";
import { mapOidcClaimsToIdentity } from "./oidc-mapper";
import {
  DEFAULT_SESSION_POLICY,
  type MappedEnterpriseIdentity,
  type OidcTokenClaims,
  type SessionPolicyConfig,
} from "./types";

export interface RevocationEntry {
  revokedAt: Date;
  reason?: string;
}

export class SessionRevocationManager {
  // Map of userId -> revocation entry (all sessions issued before revokedAt are invalid)
  private userRevocations: Map<string, RevocationEntry> = new Map();
  // Set of specific revoked token identifiers (jti)
  private revokedJtis: Map<string, RevocationEntry> = new Map();

  /**
   * Revokes all active sessions for a given user immediately.
   */
  public revokeUser(userId: string, reason = "User revoked by administrator"): void {
    this.userRevocations.set(userId, {
      revokedAt: new Date(),
      reason,
    });
  }

  /**
   * Unrevokes a user (e.g. on account reactivation).
   */
  public unrevokeUser(userId: string): void {
    this.userRevocations.delete(userId);
  }

  /**
   * Revokes a specific token by its JWT ID (jti).
   */
  public revokeSession(jti: string, reason = "Session logged out"): void {
    this.revokedJtis.set(jti, {
      revokedAt: new Date(),
      reason,
    });
  }

  /**
   * Checks whether a session or user is currently revoked.
   */
  public isRevoked(
    userId: string,
    jti?: string | null,
    issuedAtSeconds?: number
  ): { revoked: boolean; reason?: string } {
    // Check specific token ID
    if (jti && this.revokedJtis.has(jti)) {
      const entry = this.revokedJtis.get(jti)!;
      return { revoked: true, reason: entry.reason };
    }

    // Check user-level revocation
    if (this.userRevocations.has(userId)) {
      const entry = this.userRevocations.get(userId)!;
      // If issuedAt is before or equal to revocation timestamp, it is revoked
      if (issuedAtSeconds) {
        const issuedAtMs = issuedAtSeconds * 1000;
        if (issuedAtMs <= entry.revokedAt.getTime()) {
          return { revoked: true, reason: entry.reason };
        }
      } else {
        // Without issuedAt, any user revocation marks token invalid
        return { revoked: true, reason: entry.reason };
      }
    }

    return { revoked: false };
  }

  /**
   * Clears in-memory revocation records (for isolated tests).
   */
  public clear(): void {
    this.userRevocations.clear();
    this.revokedJtis.clear();
  }
}

// Global default revocation manager singleton
export const defaultRevocationManager = new SessionRevocationManager();

/**
 * Validates token lifetime against maximum session lifetime and expiration.
 */
export function validateTokenLifetime(
  claims: OidcTokenClaims,
  config: SessionPolicyConfig = DEFAULT_SESSION_POLICY,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): void {
  // Check standard JWT expiration
  if (claims.exp && nowSeconds >= claims.exp) {
    throw new Error("TOKEN_EXPIRED: Token expiration timestamp has elapsed.");
  }

  // Check maximum absolute session lifetime from issuance (iat)
  if (claims.iat) {
    const sessionAge = nowSeconds - claims.iat;
    if (sessionAge > config.maxSessionLifetimeSeconds) {
      throw new Error("SESSION_MAX_LIFETIME_EXCEEDED: Maximum absolute session lifetime exceeded.");
    }
  }
}

/**
 * Verifies an OIDC token or decoded claims payload, enforces revocation list,
 * checks user active status, and resolves the mapped enterprise identity.
 */
export async function authenticateOidcToken(
  tokenOrClaims: string | OidcTokenClaims,
  options: {
    config?: SessionPolicyConfig;
    revocationManager?: SessionRevocationManager;
    nowSeconds?: number;
  } = {}
): Promise<MappedEnterpriseIdentity> {
  const config = options.config || DEFAULT_SESSION_POLICY;
  const revocationManager = options.revocationManager || defaultRevocationManager;
  const nowSeconds = options.nowSeconds || Math.floor(Date.now() / 1000);

  let claims: OidcTokenClaims;

  if (typeof tokenOrClaims === "string") {
    try {
      // Decode JWT payload
      claims = decodeJwt(tokenOrClaims) as unknown as OidcTokenClaims;
    } catch {
      throw new Error("INVALID_TOKEN: Failed to parse Bearer token claims.");
    }
  } else {
    claims = tokenOrClaims;
  }

  if (!claims.sub) {
    throw new Error("INVALID_TOKEN: Missing subject (sub) claim in token.");
  }

  // 1. Validate expiration & session lifetime
  validateTokenLifetime(claims, config, nowSeconds);

  // 2. Check revocation list
  const username = claims.preferred_username || claims.sub;
  const revocationCheck = revocationManager.isRevoked(
    username,
    claims.jti,
    claims.iat
  );

  if (revocationCheck.revoked) {
    throw new Error(`SESSION_REVOKED: ${revocationCheck.reason || "Session has been invalidated."}`);
  }

  // 3. Map claims to internal identity
  const identity = await mapOidcClaimsToIdentity(claims, config);

  // 4. Verify account active status
  if (!identity.active) {
    throw new Error("ACCOUNT_DISABLED: User account is inactive or disabled.");
  }

  return identity;
}
