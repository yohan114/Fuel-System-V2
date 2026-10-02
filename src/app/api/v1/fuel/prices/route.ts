import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { z } from "zod";

const createPriceSchema = z.object({
  fuelKind: z.string().min(1),
  pricePerLitre: z.number().int().positive("Price in cents must be positive"),
  effectiveFrom: z.string().datetime().optional(),
});

export async function GET(req: Request) {
  const authResult = await requireApi(req, "read:fuel");
  if ("error" in authResult) return authResult.error;

  const prices = await prisma.fuelPrice.findMany({
    orderBy: { effectiveFrom: "desc" },
    include: {
      enteredBy: { select: { id: true, name: true, username: true } },
    },
  });

  return ok(prices);
}

export async function POST(req: Request) {
  const authResult = await requireApi(req, "write:fuel");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  if (auth.role !== "ADMIN") {
    return err("FORBIDDEN", "Only administrators can configure fuel prices", 403);
  }

  try {
    const body = await req.json();
    const parsed = createPriceSchema.safeParse(body);
    if (!parsed.success) {
      return err("VALIDATION_ERROR", "Invalid price parameters", 400, parsed.error.format());
    }

    const actorId = auth.user?.id || (await prisma.user.findFirst({ select: { id: true } }))?.id;
    if (!actorId) {
      return err("FORBIDDEN", "No user available to enter price", 403);
    }

    const { fuelKind, pricePerLitre, effectiveFrom } = parsed.data;
    const price = await prisma.fuelPrice.create({
      data: {
        fuelKind,
        pricePerLitre,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        source: "MANUAL",
        enteredById: actorId,
      },
    });

    return ok(price, undefined, 201);
  } catch (error) {
    console.error("[api/v1/fuel/prices POST] Error:", error);
    return err("INTERNAL_ERROR", "Failed to create price record", 500);
  }
}
