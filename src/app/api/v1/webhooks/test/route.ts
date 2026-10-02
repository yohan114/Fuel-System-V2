import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { dispatchWebhook } from "@/lib/webhooks";

export async function POST(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  await dispatchWebhook("fuel.issue.created", {
    test: true,
    message: "This is a test webhook notification from Fuel System V2",
    sampleIssue: {
      id: "test-issue-123",
      assetCode: "HEX-21",
      litres: 120.0,
      fuelKind: "AUTO_DIESEL",
      totalCostLkr: 41040,
    },
  });

  return ok({ dispatched: true, event: "fuel.issue.created" });
}
