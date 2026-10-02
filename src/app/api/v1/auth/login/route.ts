import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, signJwtToken, SessionPayload } from "@/lib/auth";
import { ok, err } from "@/lib/api/respond";
import { loginSchema } from "@/lib/api/schemas";
import { checkRateLimit } from "@/lib/api/rate-limit";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const rl = checkRateLimit(`login:${ip}`, 10, 60_000);
  if (!rl.allowed) {
    return err("RATE_LIMITED", "Too many login attempts. Please wait 1 minute.", 429);
  }

  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid username or password format", 400, parsed.error.format());
    }

    const { username, password } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.active) {
      return err("INVALID_CREDENTIALS", "Invalid username or password", 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return err("INVALID_CREDENTIALS", "Invalid username or password", 401);
    }

    const payload: SessionPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      projectId: user.projectId,
      bulkTankId: user.bulkTankId,
    };

    // Set cookie for browser sessions
    await createSession(user.id, user.username, user.role, user.name, user.projectId, user.bulkTankId);

    // Also issue JWT token for mobile / API Bearer clients
    const token = await signJwtToken(payload);

    return ok({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        projectId: user.projectId,
        bulkTankId: user.bulkTankId,
      },
    });
  } catch (error) {
    console.error("[api/v1/auth/login] Error:", error);
    return err("INTERNAL_ERROR", "Login failed due to an internal server error", 500);
  }
}
