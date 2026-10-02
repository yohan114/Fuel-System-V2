import { prisma } from "@/lib/db";
import { requireApi, generateApiKey } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { createApiKeySchema } from "@/lib/api/schemas";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can manage API keys", 403);
  }

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
        select: { id: true, name: true, username: true },
      },
    },
  });

  return ok(keys);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can create API keys", 403);
  }

  try {
    const body = await req.json();
    const parsed = createApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid API key data", 400, parsed.error.format());
    }

    const { name, scopes } = parsed.data;
    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    const created = await prisma.apiKey.create({
      data: {
        name,
        keyPrefix,
        keyHash,
        scopes,
        createdById: auth.user?.id ?? null,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        active: true,
        createdAt: true,
      },
    });

    return ok(
      {
        ...created,
        apiKey: rawKey,
        note: "Store this API key safely now. You will not be able to view it again.",
      },
      undefined,
      201
    );
  } catch (error) {
    console.error("[api/v1/api-keys] Error creating key:", error);
    return err("INTERNAL_ERROR", "Failed to generate API key", 500);
  }
}
