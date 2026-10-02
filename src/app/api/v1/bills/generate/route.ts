import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { generateBillsForMonth } from "@/lib/billing/generate";
import { z } from "zod";

const generateSchema = z.object({
  year: z.number().int().min(2020).max(2050),
  month: z.number().int().min(1).max(12),
  regenerate: z.boolean().optional(),
  basis: z.enum(["fw", "w", "d"]).optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Invalid JSON payload in request body", 400);
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Validation failed", 422, parsed.error.flatten());
  }

  try {
    const result = await generateBillsForMonth({
      year: parsed.data.year,
      month: parsed.data.month,
      regenerate: parsed.data.regenerate,
      basis: parsed.data.basis,
      actorId: auth.user?.id ?? auth.apiKey?.id ?? null,
    });

    return ok(result);
  } catch (error: any) {
    return err("INTERNAL_ERROR", error.message || "Failed to generate bills", 500);
  }
}
