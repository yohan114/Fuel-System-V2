"use server";

import { createSession, deleteSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";

export async function loginAction(prevState: any, formData: FormData) {
  const username = formData.get("username")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();

  if (!username || !password) {
    return { error: "Please enter both username and password" };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.active) {
      return { error: "Invalid username or password" };
    }

    const isValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isValid) {
      return { error: "Invalid username or password" };
    }

    // Set cookie session
    await createSession(user.id, user.username, user.role, user.name, user.projectId, user.bulkTankId);
    
    // Log login in audit trail
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        summary: `User ${user.username} logged in successfully`,
      },
    });
  } catch (err: any) {
    console.error("Login error:", err);
    return { error: "Something went wrong. Please try again." };
  }

  // Next.js redirect must be called outside the try-catch block
  redirect("/");
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
