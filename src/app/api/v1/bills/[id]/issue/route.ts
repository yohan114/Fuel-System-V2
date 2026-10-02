import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { finalizeBillAction } from "@/app/actions/billing";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is acceptable
  }

  const result = await finalizeBillAction(id, body.overrideReason);
  if ("error" in result && result.error) {
    return err("OPERATION_FAILED", result.error, 400);
  }
  if ("blocked" in result && result.blocked) {
    return err("BLOCKED", "Invoice requires clarification override", 422, { reasons: result.reasons });
  }

  return ok(result);
}
