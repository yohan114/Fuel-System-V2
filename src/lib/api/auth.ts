import crypto from "crypto";
import { prisma } from "../db";
import { getSession, loadCurrentUser, verifyJwtToken } from "../auth";
import { err } from "./respond";

export interface ApiAuthContext {
  authType: "api_key" | "jwt" | "cookie";
  role: string;
  user: {
    id: string;
    username: string;
    name: string;
    role: string;
    projectId: string | null;
    bulkTankId: string | null;
  } | null;
  apiKey?: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string;
  };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(prefix = "fs_live"): {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const randomBytes = crypto.randomBytes(24).toString("hex");
  const rawKey = `${prefix}_${randomBytes}`;
  const keyPrefix = `${prefix}_${randomBytes.slice(0, 8)}...`;
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

export function hasScope(grantedScopes: string, requiredScope?: string): boolean {
  if (!requiredScope) return true;
  const list = grantedScopes.split(",").map((s) => s.trim());
  if (list.includes("*")) return true;
  if (requiredScope.startsWith("read:") && (list.includes("read:*") || list.includes("*"))) return true;
  if (requiredScope.startsWith("write:") && (list.includes("write:*") || list.includes("*"))) return true;
  return list.includes(requiredScope);
}

// Role-to-scope mapping for web session users accessing the API
export function roleAllowsScope(role: string, requiredScope?: string): boolean {
  if (!requiredScope) return true;
  if (role === "ADMIN") return true;
  if (role === "ALLOCATOR") {
    return requiredScope.startsWith("read:") || requiredScope === "write:assignments";
  }
  if (role === "WORKSHOP") {
    // Workshop operator scope is distinct from commercial billing and rates (Master Plan SEC-02)
    if (requiredScope === "read:billing" || requiredScope === "read:rates" || requiredScope === "read:budgets") {
      return false;
    }
    return (
      requiredScope.startsWith("read:") ||
      requiredScope === "write:fuel" ||
      requiredScope === "write:readings" ||
      requiredScope === "write:services" ||
      requiredScope === "write:meter-outages"
    );
  }
  if (role === "SITE_PUMP") {
    // Site pump scope operates local fuel pumping and logs; commercial billing and rates are restricted
    if (requiredScope === "read:billing" || requiredScope === "read:rates" || requiredScope === "read:budgets") {
      return false;
    }
    return (
      requiredScope.startsWith("read:") ||
      requiredScope === "write:fuel" ||
      requiredScope === "write:readings" ||
      requiredScope === "write:conditions" ||
      requiredScope === "write:meter-outages"
    );
  }
  if (role === "USER") {
    // Site user / PM: reads fleet, fuel, own billing (further guarded by billingScope); rates are restricted
    if (requiredScope === "read:rates") {
      return false;
    }
    return (
      requiredScope.startsWith("read:") ||
      requiredScope === "write:conditions" ||
      requiredScope === "write:requests"
    );
  }
  return false;
}

export async function requireApi(
  req: Request,
  requiredScope?: string
): Promise<{ auth: ApiAuthContext } | { error: ReturnType<typeof err> }> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();

    // 1. API Key Authentication (e.g. fs_live_...)
    if (token.startsWith("fs_")) {
      const keyHash = hashApiKey(token);
      const keyRecord = await prisma.apiKey.findUnique({
        where: { keyHash },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              name: true,
              role: true,
              projectId: true,
              bulkTankId: true,
              active: true,
            },
          },
        },
      });

      if (!keyRecord || !keyRecord.active || keyRecord.revokedAt) {
        return { error: err("UNAUTHORIZED", "Invalid, inactive, or revoked API key", 401) };
      }

      if (!hasScope(keyRecord.scopes, requiredScope)) {
        return {
          error: err(
            "FORBIDDEN",
            `API key lacks required scope '${requiredScope}'. Granted: '${keyRecord.scopes}'`,
            403
          ),
        };
      }

      // Record lastUsedAt non-blockingly
      prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: { lastUsedAt: new Date() },
      }).catch((e) => console.error("[api] Failed to update apiKey lastUsedAt:", e));

      return {
        auth: {
          authType: "api_key",
          role: keyRecord.createdBy?.role ?? "API_USER",
          user: keyRecord.createdBy ? {
            id: keyRecord.createdBy.id,
            username: keyRecord.createdBy.username,
            name: keyRecord.createdBy.name,
            role: keyRecord.createdBy.role,
            projectId: keyRecord.createdBy.projectId,
            bulkTankId: keyRecord.createdBy.bulkTankId,
          } : null,
          apiKey: {
            id: keyRecord.id,
            name: keyRecord.name,
            keyPrefix: keyRecord.keyPrefix,
            scopes: keyRecord.scopes,
          },
        },
      };
    }

    // 2. JWT Bearer Token Authentication
    const session = await verifyJwtToken(token);
    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          projectId: true,
          bulkTankId: true,
          active: true,
        },
      });

      if (!user || !user.active) {
        return { error: err("UNAUTHORIZED", "User account is disabled or missing", 401) };
      }

      if (!roleAllowsScope(user.role, requiredScope)) {
        return { error: err("FORBIDDEN", `Role '${user.role}' lacks permission for '${requiredScope}'`, 403) };
      }

      return {
        auth: {
          authType: "jwt",
          role: user.role,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            projectId: user.projectId,
            bulkTankId: user.bulkTankId,
          },
        },
      };
    }

    return { error: err("UNAUTHORIZED", "Invalid Bearer token", 401) };
  }

  // 3. Cookie Session Authentication fallback (for browser AJAX / dashboard client calls)
  const session = await getSession();
  const user = await loadCurrentUser();

  if (session && user && user.active) {
    if (!roleAllowsScope(user.role, requiredScope)) {
      return { error: err("FORBIDDEN", `Role '${user.role}' lacks permission for '${requiredScope}'`, 403) };
    }

    return {
      auth: {
        authType: "cookie",
        role: user.role,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          projectId: user.projectId,
          bulkTankId: user.bulkTankId,
        },
      },
    };
  }

  return { error: err("UNAUTHORIZED", "Authentication required. Provide an 'Authorization: Bearer <key>' header or log in.", 401) };
}
