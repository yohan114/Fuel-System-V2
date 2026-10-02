import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { deleteWebhook } from "@/lib/webhooks";

export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  const deleted = await deleteWebhook(id);
  if (!deleted) {
    return err("NOT_FOUND", `Webhook '${id}' not found`, 404);
  }

  return ok({ id, deleted: true });
}
