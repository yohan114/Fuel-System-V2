import { requireApi } from "@/lib/api/auth";
import { ok, err } from "@/lib/api/respond";
import { prisma } from "@/lib/db";
import { markBillPaidAction } from "@/app/actions/billing";
import { z } from "zod";

const paymentSchema = z.object({
  amount: z.number().positive(),
  paidDate: z.string().optional(),
  method: z.string().optional(),
  reference: z.string().optional(),
  note: z.string().optional(),
});

import { canReadBillFor } from "@/lib/roles";

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "read:billing");
  if ("error" in authResult) return authResult.error;

  const { auth } = authResult;
  const { id } = await props.params;

  const bill = await prisma.bill.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  });
  if (!bill) {
    return err("NOT_FOUND", `Bill '${id}' not found`, 404);
  }
  if (auth.user && !canReadBillFor(auth.user, bill.projectId)) {
    return err("FORBIDDEN", "You do not have access to view this bill", 403);
  }

  const payments = await prisma.payment.findMany({
    where: { billId: id },
    orderBy: { paidDate: "desc" },
  });

  return ok(payments);
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const authResult = await requireApi(req, "admin");
  if ("error" in authResult) return authResult.error;

  const { id } = await props.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("INVALID_JSON", "Invalid JSON payload in request body", 400);
  }

  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Validation failed", 422, parsed.error.flatten());
  }

  const fd = new FormData();
  fd.set("amount", parsed.data.amount.toString());
  if (parsed.data.paidDate) fd.set("paidDate", parsed.data.paidDate);
  if (parsed.data.method) fd.set("method", parsed.data.method);
  if (parsed.data.reference) fd.set("paymentRef", parsed.data.reference);
  if (parsed.data.note) fd.set("paymentNote", parsed.data.note);

  const res = await markBillPaidAction(id, fd);
  if ("error" in res && res.error) {
    return err("OPERATION_FAILED", res.error, 400);
  }

  return ok(res);
}
