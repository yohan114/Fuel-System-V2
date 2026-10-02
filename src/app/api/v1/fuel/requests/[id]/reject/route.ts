import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { rejectRequestAction } from "@/app/actions/fuel";

export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  let reviewNote: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.reviewNote === "string") reviewNote = body.reviewNote;
  } catch {
    // Body optional
  }

  const result = await rejectRequestAction(id, reviewNote);
  if (result.error) {
    return err("REJECTION_FAILED", result.error, 400);
  }

  return ok({ message: "Fuel request rejected", requestId: id });
}
