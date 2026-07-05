"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Upsert a per-site monthly fuel budget.
export async function setBudgetAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to set budgets" };
  }

  const projectId = formData.get("projectId")?.toString();
  const year = parseInt(formData.get("year")?.toString() || "", 10);
  const month = parseInt(formData.get("month")?.toString() || "", 10);
  const litresStr = formData.get("budgetLitres")?.toString().trim();
  const amountStr = formData.get("budgetAmount")?.toString().trim();
  const note = formData.get("note")?.toString().trim() || null;

  if (!projectId || !year || !month || month < 1 || month > 12) {
    return { error: "Project, year and month are required" };
  }

  const budgetLitres = litresStr ? parseFloat(litresStr) : null;
  const budgetAmountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) : null;
  if (budgetLitres != null && (isNaN(budgetLitres) || budgetLitres < 0)) return { error: "Budget litres must be ≥ 0" };
  if (budgetAmountCents != null && (isNaN(budgetAmountCents) || budgetAmountCents < 0)) return { error: "Budget amount must be ≥ 0" };

  try {
    await prisma.budget.upsert({
      where: { projectId_year_month: { projectId, year, month } },
      update: { budgetLitres, budgetAmountCents, note, createdById: admin.id },
      create: { projectId, year, month, budgetLitres, budgetAmountCents, note, createdById: admin.id },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Budget",
        summary: `Set budget for project ${projectId} ${year}-${pad2(month)}: ${budgetLitres ?? "—"} L / Rs. ${budgetAmountCents != null ? (budgetAmountCents / 100).toLocaleString("en-LK") : "—"}`,
      },
    });
    revalidatePath("/admin/budgets");
    return { success: true };
  } catch (err: any) {
    console.error("Set budget error:", err);
    return { error: err.message || "Failed to set budget" };
  }
}

// Create a DRAFT credit note against an issued/overdue/paid bill.
export async function createCreditNoteAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to create credit notes" };
  }

  const billId = formData.get("billId")?.toString();
  const reason = formData.get("reason")?.toString().trim();
  const amountStr = formData.get("amount")?.toString().trim();

  if (!billId || !reason || !amountStr) {
    return { error: "Bill, reason and amount are required" };
  }
  const amountCents = Math.round(parseFloat(amountStr) * 100);
  if (isNaN(amountCents) || amountCents <= 0) return { error: "Amount must be greater than zero" };

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status === "DRAFT") return { error: "Issue the invoice before crediting it" };
    if (amountCents > bill.grandTotalCents) return { error: "Credit cannot exceed the invoice total" };

    const cn = await prisma.creditNote.create({
      data: { billId, reason, amountCents, status: "DRAFT", createdById: admin.id },
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "CREATE",
        entity: "CreditNote",
        entityId: cn.id,
        summary: `Drafted credit note for ${bill.invoiceNumber || bill.assetCode}: Rs. ${(amountCents / 100).toLocaleString("en-LK")} — ${reason}`,
      },
    });
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Create credit note error:", err);
    return { error: err.message || "Failed to create credit note" };
  }
}

// Issue a DRAFT credit note (assigns a number and reduces the receivable).
export async function issueCreditNoteAction(creditNoteId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to issue credit notes" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const cn = await tx.creditNote.findUnique({ where: { id: creditNoteId }, include: { bill: true } });
      if (!cn) throw new Error("Credit note not found");
      if (cn.status !== "DRAFT") throw new Error("Credit note already issued");

      const issuedCount = await tx.creditNote.count({
        where: { status: "ISSUED", bill: { year: cn.bill.year, month: cn.bill.month } },
      });
      const number = `CN-${cn.bill.year}-${pad2(cn.bill.month)}-${String(issuedCount + 1).padStart(4, "0")}`;

      await tx.creditNote.update({
        where: { id: creditNoteId },
        data: { status: "ISSUED", issuedDate: new Date(), number },
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "APPROVE",
          entity: "CreditNote",
          entityId: creditNoteId,
          summary: `Issued credit note ${number} (Rs. ${(cn.amountCents / 100).toLocaleString("en-LK")}) against ${cn.bill.invoiceNumber || cn.bill.assetCode}`,
        },
      });
      return { number, billId: cn.billId };
    });

    revalidatePath(`/billing/${result.billId}`);
    revalidatePath("/billing/aging");
    return { success: true, number: result.number };
  } catch (err: any) {
    console.error("Issue credit note error:", err);
    return { error: err.message || "Failed to issue credit note" };
  }
}
