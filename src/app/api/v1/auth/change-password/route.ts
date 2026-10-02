import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { changePasswordSchema } from "@/lib/api/schemas";

export async function POST(req: Request) {
  const authResult = await requireApi(req);
  if ("error" in authResult) {
    return authResult.error;
  }

  const { auth } = authResult;
  if (!auth.user) {
    return err("UNAUTHORIZED", "User context required to change password", 401);
  }

  try {
    const body = await req.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid password data", 400, parsed.error.format());
    }

    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
    });

    if (!user) {
      return err("NOT_FOUND", "User not found", 404);
    }

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return err("INVALID_CREDENTIALS", "Incorrect current password", 400);
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return ok({ message: "Password updated successfully" });
  } catch (error) {
    console.error("[api/v1/auth/change-password] Error:", error);
    return err("INTERNAL_ERROR", "Failed to change password", 500);
  }
}
