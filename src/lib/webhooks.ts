import { prisma } from "@/lib/db";
import crypto from "crypto";

export type WebhookEvent =
  | "fuel.issue.created"
  | "fuel.issue.voided"
  | "bill.issued"
  | "bill.paid"
  | "tank.dip.shortfall";

export interface WebhookConfig {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
}

// In-database setting storage for webhooks without needing immediate schema change
// Setting key prefix: "webhook:"
export async function listWebhooks(): Promise<WebhookConfig[]> {
  const rows = await prisma.setting.findMany({
    where: { key: { startsWith: "webhook:" } },
  });

  return rows
    .map((r) => {
      try {
        return JSON.parse(r.value) as WebhookConfig;
      } catch {
        return null;
      }
    })
    .filter((w): w is WebhookConfig => w !== null);
}

export async function saveWebhook(config: WebhookConfig): Promise<void> {
  await prisma.setting.upsert({
    where: { key: `webhook:${config.id}` },
    update: { value: JSON.stringify(config) },
    create: { key: `webhook:${config.id}`, value: JSON.stringify(config) },
  });
}

export async function deleteWebhook(id: string): Promise<boolean> {
  try {
    await prisma.setting.delete({ where: { key: `webhook:${id}` } });
    return true;
  } catch {
    return false;
  }
}

export async function dispatchWebhook(event: WebhookEvent, payload: Record<string, any>): Promise<void> {
  const webhooks = await listWebhooks();
  const activeMatching = webhooks.filter(
    (w) => w.active && (w.events.includes("*") || w.events.includes(event))
  );

  if (activeMatching.length === 0) return;

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (const hook of activeMatching) {
    // Asynchronously dispatch webhook without blocking caller
    const signature = crypto
      .createHmac("sha256", hook.secret)
      .update(body)
      .digest("hex");

    fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FuelSystem-Event": event,
        "X-FuelSystem-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(10000),
    }).catch((err) => {
      console.error(`[webhook] Failed to dispatch ${event} to ${hook.url}:`, err.message);
    });
  }
}
