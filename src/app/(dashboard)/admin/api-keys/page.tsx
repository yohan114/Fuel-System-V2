import React from "react";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import ApiKeyClient from "./ApiKeyClient";

export default async function AdminApiKeysPage() {
  await requireAdmin();

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scopes: true,
      active: true,
      createdAt: true,
      revokedAt: true,
      lastUsedAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  return <ApiKeyClient initialKeys={keys} />;
}
