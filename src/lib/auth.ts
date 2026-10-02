import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";
import { resolveAuthSecret } from "./auth-secret";

const COOKIE_NAME = "session";

// Resolved lazily so `next build` (which runs without runtime secrets) still
// works; any attempt to sign or verify a session in production without a real
// AUTH_SECRET fails hard instead of silently using the known fallback.
let cachedSecret: Uint8Array | null = null;
let warnedDevFallback = false;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  // Prefer a system-scoped secret so co-hosting alongside other E&C systems on
  // one box (shared machine-level AUTH_SECRET) cannot silently share a signing
  // key. Falls back to AUTH_SECRET so existing deployments keep working.
  const configured = process.env.FUEL_AUTH_SECRET || process.env.AUTH_SECRET;
  const { secret, usedFallback } = resolveAuthSecret(configured, process.env.NODE_ENV);
  if (usedFallback && !warnedDevFallback) {
    warnedDevFallback = true;
    console.warn("[auth] AUTH_SECRET not set — using the insecure development fallback secret.");
  }
  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  name: string;
  projectId: string | null;
  bulkTankId: string | null;
}

export async function createSession(
  userId: string, 
  username: string, 
  role: string, 
  name: string, 
  projectId: string | null,
  bulkTankId: string | null = null
) {
  const payload: SessionPayload = { userId, username, role, name, projectId, bulkTankId };
  const token = await new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// React.cache dedupes within a single request. Previously every dashboard
// render verified the JWT twice (once in the layout, once in the page) and
// read the user row twice as well — four round-trips per click just to prove
// who you are. With cache() the layout, the page, and any server action in
// between all see the same resolved session/user without rechecking.
export const getSession = cache(async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
});

// Cached per-request so the layout's existence-check and the page's
// requireUser() share one SELECT. Returns null for the unauthenticated case
// so callers can decide between redirect and throw.
export const loadCurrentUser = cache(async function loadCurrentUser() {
  // The TEST_ENV bypass returns the admin user without a session — strictly
  // guarded so running next dev on a server never accidentally bypasses auth.
  if (
    process.env.TEST_ENV === "true" &&
    (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined || !process.env.NEXT_RUNTIME)
  ) {
    return prisma.user.findFirst({ where: { username: "admin" } });
  }
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
});

export async function requireUser() {
  const user = await loadCurrentUser();
  if (!user || !user.active) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new Error("FORBIDDEN");
  }
  return user;
}
