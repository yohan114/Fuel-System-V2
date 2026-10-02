import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { getAgingReport } from "@/lib/billing/aging";
import { billingScope } from "@/lib/roles";

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const scope = billingScope(auth.user);
  if (scope.kind === "none") {
    return err("FORBIDDEN", "Receivables are not accessible for this account", 403);
  }

  const url = new URL(req.url);
  const requestedProject = url.searchParams.get("projectId") || undefined;
  const projectId = scope.kind === "project" ? scope.projectId : requestedProject;

  const report = await getAgingReport({ projectId });
  return ok(report);
}
