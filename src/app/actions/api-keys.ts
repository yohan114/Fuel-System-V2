"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { generateApiKey } from "@/lib/api/auth";
import { revalidatePath } from "next/cache";

export async function createApiKeyAction(name: string, scopes: string = "*") {
  let user;
  try {
    user = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to create API keys." };
  }

  if (!name || !name.trim()) {
    return { error: "Key name is required." };
  }

  try {
    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    const created = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        keyPrefix,
        keyHash,
        scopes: scopes.trim() || "*",
        createdById: user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CREATE_API_KEY",
        entity: "ApiKey",
        entityId: created.id,
        summary: `Created API key '${created.name}' (${created.keyPrefix}) with scopes: ${created.scopes}`,
        actorId: user.id,
      },
    });

    revalidatePath("/admin/api-keys");
    return {
      success: true,
      apiKey: rawKey,
      keyId: created.id,
      name: created.name,
      keyPrefix: created.keyPrefix,
    };
  } catch (error) {
    console.error("[createApiKeyAction] Error:", error);
    return { error: "Failed to generate API key." };
  }
}

export async function revokeApiKeyAction(id: string) {
  let user;
  try {
    user = await assertCan("manage");
  } catch (err) {
    return { error: "You are not authorized to revoke API keys." };
  }

  try {
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key) {
      return { error: "API key not found." };
    }

    await prisma.apiKey.update({
      where: { id },
      data: {
        active: false,
        revokedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "REVOKE_API_KEY",
        entity: "ApiKey",
        entityId: key.id,
        summary: `Revoked API key '${key.name}' (${key.keyPrefix})`,
        actorId: user.id,
      },
    });

    revalidatePath("/admin/api-keys");
    return { success: true };
  } catch (error) {
    console.error("[revokeApiKeyAction] Error:", error);
    return { error: "Failed to revoke API key." };
  }
}
