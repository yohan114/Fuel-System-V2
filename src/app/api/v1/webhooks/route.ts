import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { listWebhooks, saveWebhook, type WebhookConfig } from "@/lib/webhooks";
import crypto from "crypto";
import { z } from "zod";

const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const hooks = await listWebhooks();
  // Mask secrets in response
  const sanitized = hooks.map((h) => ({
    ...h,
    secret: `${h.secret.slice(0, 4)}...${h.secret.slice(-4)}`,
  }));

  return ok(sanitized);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Invalid JSON payload in request body", 400);
  }

  const parsed = createWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Validation failed", 422, parsed.error.flatten());
  }

  const secret = parsed.data.secret || `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const config: WebhookConfig = {
    id: crypto.randomUUID(),
    url: parsed.data.url,
    events: parsed.data.events,
    secret,
    active: true,
  };

  await saveWebhook(config);

  return ok(config, { message: "Store the signing secret securely; it will not be displayed again." }, 201);
}
