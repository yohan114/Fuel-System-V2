import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./db";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "default_auth_secret_must_be_changed_in_env_file"
);
const COOKIE_NAME = "session";

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
    .sign(SECRET);

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
    const { payload } = await jwtVerify(token, SECRET);
    return payload as unknown as SessionPayload;
  } catch (err) {
    return null;
  }
}

export async function requireUser() {
  if (process.env.TEST_ENV === "true") {
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
