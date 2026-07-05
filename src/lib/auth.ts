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

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch (err) {
    return null;
  }
}

export async function requireUser() {
  // The TEST_ENV bypass returns the admin user without a session — it must
  // never be reachable in production, even if the env var leaks onto the box.
  if (process.env.TEST_ENV === "true" && process.env.NODE_ENV !== "production") {
    const user = await prisma.user.findFirst({
      where: { username: "admin" },
    });
    if (!user) throw new Error("UNAUTHORIZED");
    return user;
  }

  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

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
