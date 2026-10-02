import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { voidFuelIssueSchema } from "@/lib/api/schemas";
import { voidFuelIssueAction } from "@/app/actions/fuel-void";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can void fuel issues", 403);
  }

  const { id } = await props.params;

  try {
    const body = await req.json();
    const parsed = voidFuelIssueSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid void reason", 400, parsed.error.format());
    }

    const result = await voidFuelIssueAction(id, parsed.data.reason);
    if (result.error) {
      return err("VOID_FAILED", result.error, 400);
    }

    return ok({ message: "Fuel issue voided successfully", id });
  } catch (error) {
    console.error("[api/v1/fuel/issues/[id]/void] Error:", error);
    return err("INTERNAL_ERROR", "Failed to void fuel issue", 500);
  }
}
