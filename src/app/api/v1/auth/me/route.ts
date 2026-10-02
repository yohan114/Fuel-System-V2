import { requireApi } from "@/lib/api/auth";
import { ok } from "@/lib/api/respond";

export async function GET(req: Request) {
  const authResult = await requireApi(req);
  if ("error" in authResult) {
    return authResult.error;
  }

  const { auth } = authResult;
  return ok({
    authType: auth.authType,
    role: auth.role,
    user: auth.user,
    apiKey: auth.apiKey ? {
      id: auth.apiKey.id,
      name: auth.apiKey.name,
      keyPrefix: auth.apiKey.keyPrefix,
      scopes: auth.apiKey.scopes,
    } : null,
  });
}
