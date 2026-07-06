"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { getBillingConfig } from "@/lib/billing/config";
import { resolvePeriod } from "@/lib/billing/period";
import { billClarifyReasons } from "@/lib/billing/clarify";
import { nextInvoiceNumber } from "@/lib/billing/invoice-number";
import {
  generateBillsForMonth,
  generateBillForAsset,
  sweepOverdueBills,
} from "@/lib/billing/generate";

const MODES = ["hourly", "perkm", "perday"];
const BASES = ["fw", "w", "d"];

// Generate (or regenerate) all bills for a month.
export async function generateBillsForMonthAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to generate bills" };
  }

  const year = parseInt(formData.get("year")?.toString() || "", 10);
  const month = parseInt(formData.get("month")?.toString() || "", 10);
  const regenerate = formData.get("regenerate") === "true" || formData.get("regenerate") === "on";
  // Optional whole-month hire basis: force every bill in the run onto Dry / Wet
  // / Fully Wet. Empty = respect each vehicle's default. Forcing implies a
  // regenerate so existing drafts are re-costed onto the chosen basis.
  const basisRaw = formData.get("basis")?.toString() || "";
  const basis = BASES.includes(basisRaw) ? (basisRaw as "fw" | "w" | "d") : undefined;

  if (!year || !month || month < 1 || month > 12) {
    return { error: "A valid year and month are required" };
  }

  try {
    const result = await generateBillsForMonth({ year, month, regenerate: regenerate || !!basis, actorId: admin.id, basis });
    revalidatePath("/billing");
    return { success: true, result };
  } catch (err: any) {
    console.error("Generate bills error:", err);
    return { error: err.message || "Failed to generate bills" };
  }
}

// Regenerate a single DRAFT bill from the latest rate card + data.
export async function regenerateBillAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to regenerate bills" };
  }

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "DRAFT") return { error: "Cannot regenerate a finalized invoice" };

    const period = resolvePeriod(bill.year, bill.month);
    await generateBillForAsset(bill.assetId, period, { regenerate: true, actorId: admin.id });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Regenerate bill error:", err);
    return { error: err.message || "Failed to regenerate bill" };
  }
}

// Edit a DRAFT bill's billing mode / basis / minimum / notes, then recompute.
export async function updateBillDraftAction(billId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to edit bills" };
  }

  const billingMode = formData.get("billingMode")?.toString() || "";
  const rateBasis = formData.get("rateBasis")?.toString() || "";
  const minStr = formData.get("minimumUnits")?.toString() || "";
  const notes = formData.get("notes")?.toString().trim() || null;

  if (!MODES.includes(billingMode)) return { error: "Invalid billing mode" };
  if (!BASES.includes(rateBasis)) return { error: "Invalid rate basis" };
  const minimumUnits = parseFloat(minStr);
  if (isNaN(minimumUnits) || minimumUnits < 0) return { error: "Minimum units must be zero or greater" };

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "DRAFT") return { error: "Only draft bills can be edited" };

    // Persist the structural choices, then recompute (regenerate reads them back
    // and re-derives rate / usage / fuel / totals). notes are preserved.
    await prisma.bill.update({
      where: { id: billId },
      data: { billingMode, rateBasis, minimumUnits, notes },
    });

    const period = resolvePeriod(bill.year, bill.month);
    await generateBillForAsset(bill.assetId, period, { regenerate: true, actorId: admin.id });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Update bill draft error:", err);
    return { error: err.message || "Failed to update bill" };
  }
}

// Set a vehicle's default hire basis (Fully Wet / Wet / Dry). Optionally
// re-cost every open DRAFT for the vehicle at the new basis so the change is
// reflected immediately, not just on the next generation run.
export async function setVehicleBasisAction(assetId: string, basis: string, applyToDrafts: boolean) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to set hire basis" };
  }
  if (!BASES.includes(basis)) return { error: "Invalid hire basis" };
  try {
    const rate = await prisma.rentalRate.findUnique({ where: { assetId }, include: { asset: { select: { code: true } } } });
    if (!rate) return { error: "This vehicle has no rate card to configure" };
    await prisma.rentalRate.update({ where: { assetId }, data: { defaultBasis: basis } });

    let regenerated = 0;
    if (applyToDrafts) {
      const drafts = await prisma.bill.findMany({ where: { assetId, status: "DRAFT" }, select: { id: true, year: true, month: true } });
      for (const d of drafts) {
        await prisma.bill.update({ where: { id: d.id }, data: { rateBasis: basis } });
        await generateBillForAsset(assetId, resolvePeriod(d.year, d.month), { regenerate: true, actorId: admin.id });
        regenerated++;
      }
    }
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: "UPDATE", entity: "RentalRate", entityId: assetId, summary: `Set default hire basis for ${rate.asset.code} to ${basis.toUpperCase()}${applyToDrafts ? ` (re-costed ${regenerated} draft${regenerated !== 1 ? "s" : ""})` : ""}` },
    });
    revalidatePath(`/fleet/${rate.asset.code}`);
    revalidatePath("/billing");
    return { success: true, regenerated };
  } catch (err: any) {
    console.error("Set vehicle basis error:", err);
    return { error: err.message || "Failed to set hire basis" };
  }
}

// Bulk re-cost selected DRAFT bills at a chosen hire basis (Fully Wet / Wet /
// Dry). Skips non-drafts. Used for site-wide / many-vehicle dry-hire changes.
export async function bulkSetBillBasisAction(billIds: string[], basis: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change bills" };
  }
  if (!BASES.includes(basis)) return { error: "Invalid hire basis" };
  if (!Array.isArray(billIds) || billIds.length === 0) return { error: "No bills selected" };

  let updated = 0;
  let skipped = 0;
  const errors: { billId: string; message: string }[] = [];
  for (const billId of billIds) {
    try {
      const bill = await prisma.bill.findUnique({ where: { id: billId }, select: { id: true, assetId: true, year: true, month: true, status: true } });
      if (!bill || bill.status !== "DRAFT") { skipped++; continue; }
      await prisma.bill.update({ where: { id: billId }, data: { rateBasis: basis } });
      await generateBillForAsset(bill.assetId, resolvePeriod(bill.year, bill.month), { regenerate: true, actorId: admin.id });
      updated++;
    } catch (err: any) {
      errors.push({ billId, message: err.message || "error" });
    }
  }
  await prisma.auditLog.create({
    data: { actorId: admin.id, action: "UPDATE", entity: "Bill", summary: `Bulk set ${updated} draft bill(s) to ${basis.toUpperCase()} basis${skipped ? ` (skipped ${skipped})` : ""}` },
  });
  revalidatePath("/billing");
  return { success: true, updated, skipped, errors };
}

// Finalize a DRAFT into an ISSUED invoice with a unique invoice number + due date.
export async function finalizeBillAction(billId: string, overrideReason?: string | null) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to issue invoices" };
  }

  try {
    const cfg = await getBillingConfig();

    // Gate: a bill that needs clarification (meter vs fuel, or unpriced fuel)
    // cannot be issued unless the admin supplies an override reason, which is
    // recorded on the invoice and in the audit log.
    const draft = await prisma.bill.findUnique({ where: { id: billId } });
    if (!draft) return { error: "Bill not found" };
    if (draft.status !== "DRAFT") return { error: "Only draft bills can be issued" };
    const reasons = billClarifyReasons(draft);
    const reason = overrideReason?.trim();
    if (reasons.length > 0 && !reason) {
      return { blocked: true as const, reasons };
    }

    const invoiceNumber = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "DRAFT") throw new Error("Only draft bills can be issued");

      const number = await nextInvoiceNumber(tx, cfg.invoicePrefix, bill.year);

      const issuedDate = new Date();
      const dueDate = new Date(issuedDate.getTime() + cfg.dueDays * 24 * 60 * 60 * 1000);

      const overrideNote =
        reasons.length > 0 && reason
          ? `${bill.notes ? bill.notes + " · " : ""}Issued with override: ${reason}`
          : bill.notes;

      await tx.bill.update({
        where: { id: billId },
        data: { status: "ISSUED", invoiceNumber: number, issuedDate, dueDate, notes: overrideNote },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entity: "Bill",
          entityId: billId,
          summary:
            reasons.length > 0 && reason
              ? `Issued invoice ${number} for ${bill.assetCode} (${bill.periodKey}) — OVERRIDE despite ${reasons.length} clarification flag(s): ${reason}`
              : `Issued invoice ${number} for ${bill.assetCode} (${bill.periodKey})`,
        },
      });
      return number;
    });

    // Optional: auto-email the freshly issued invoice to the site contact.
    // Best-effort — a mail hiccup must never undo a successful issue, so we
    // swallow anything the delivery reports and just surface who it reached.
    let emailedTo: string | undefined;
    if (cfg.autoEmailOnIssue) {
      const mail = await deliverInvoiceEmail(billId, admin.id);
      if (mail.sentTo) emailedTo = mail.sentTo;
    }

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true, invoiceNumber, emailedTo };
  } catch (err: any) {
    console.error("Finalize bill error:", err);
    return { error: err.message || "Failed to issue invoice" };
  }
}

// Record a (possibly partial) payment against an ISSUED / OVERDUE invoice. The
// invoice flips to PAID only once the ledger covers the grand total; otherwise
// it keeps its outstanding balance. Bill.paidAmountCents/paidDate mirror the
// running total for display and backward compatibility.
export async function markBillPaidAction(billId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to record payments" };
  }

  const paidLkrStr = formData.get("paidLkr")?.toString() || "";
  const paymentRef = formData.get("paymentRef")?.toString().trim() || null;
  const method = formData.get("method")?.toString().trim() || null;
  const paymentNote = formData.get("paymentNote")?.toString().trim() || null;
  const paidDateStr = formData.get("paidDate")?.toString() || "";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId }, include: { payments: true } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "ISSUED" && bill.status !== "OVERDUE") {
        throw new Error("Only issued invoices can take a payment");
      }

      const priorPaid = bill.payments.reduce((s, p) => s + p.amountCents, 0);
      const outstanding = Math.max(bill.grandTotalCents - priorPaid, 0);
      // Default the amount to the remaining balance, not the whole invoice.
      const amountCents = paidLkrStr ? Math.round(parseFloat(paidLkrStr) * 100) : outstanding;
      if (isNaN(amountCents) || amountCents <= 0) {
        throw new Error("Payment amount must be greater than zero");
      }
      const paidDate = paidDateStr ? new Date(paidDateStr) : new Date();

      await tx.payment.create({
        data: { billId, amountCents, paidDate, method, reference: paymentRef, note: paymentNote, createdById: admin.id },
      });

      const paidCents = priorPaid + amountCents;
      const fullyPaid = paidCents >= bill.grandTotalCents;
      await tx.bill.update({
        where: { id: billId },
        data: {
          paidAmountCents: paidCents,
          paidDate,
          paymentRef,
          paymentNote,
          ...(fullyPaid ? { status: "PAID" } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entity: "Bill",
          entityId: billId,
          summary: `${fullyPaid ? "Settled" : "Part-paid"} ${bill.invoiceNumber || bill.assetCode}: Rs. ${(amountCents / 100).toLocaleString("en-LK")} (paid Rs. ${(paidCents / 100).toLocaleString("en-LK")} of ${(bill.grandTotalCents / 100).toLocaleString("en-LK")})`,
        },
      });
      return { fullyPaid };
    });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true, fullyPaid: result.fullyPaid };
  } catch (err: any) {
    console.error("Record payment error:", err);
    return { error: err.message || "Failed to record payment" };
  }
}

// Bulk-finalize many DRAFT bills into ISSUED invoices in one pass. Skips any
// that are not DRAFT. Returns per-bill outcomes for the UI.
export async function bulkFinalizeBillsAction(billIds: string[]) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to issue invoices" };
  }
  if (!Array.isArray(billIds) || billIds.length === 0) {
    return { error: "No bills selected" };
  }

  const cfg = await getBillingConfig();
  let finalized = 0;
  let skipped = 0;
  let needsClarify = 0;
  const errors: { billId: string; message: string }[] = [];

  for (const billId of billIds) {
    try {
      await prisma.$transaction(async (tx) => {
        const bill = await tx.bill.findUnique({ where: { id: billId } });
        if (!bill) throw new Error("Bill not found");
        if (bill.status !== "DRAFT") {
          skipped++;
          return;
        }
        // Bulk never force-overrides: bills needing clarification are left as
        // drafts to be reviewed and issued individually.
        if (billClarifyReasons(bill).length > 0) {
          needsClarify++;
          return;
        }
        const number = await nextInvoiceNumber(tx, cfg.invoicePrefix, bill.year);
        const issuedDate = new Date();
        const dueDate = new Date(issuedDate.getTime() + cfg.dueDays * 24 * 60 * 60 * 1000);

        await tx.bill.update({
          where: { id: billId },
          data: { status: "ISSUED", invoiceNumber: number, issuedDate, dueDate },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "UPDATE",
            entity: "Bill",
            entityId: billId,
            summary: `Issued invoice ${number} for ${bill.assetCode} (${bill.periodKey}) [bulk]`,
          },
        });
        finalized++;
      });
    } catch (err: any) {
      errors.push({ billId, message: err.message || "error" });
    }
  }

  revalidatePath("/billing");
  return { success: true, finalized, skipped, needsClarify, errors };
}

// Bulk-record full payment against many ISSUED / OVERDUE invoices. Each is
// marked paid in full (grand total) with today's date. Skips others.
export async function bulkMarkPaidAction(billIds: string[]) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to record payments" };
  }
  if (!Array.isArray(billIds) || billIds.length === 0) {
    return { error: "No bills selected" };
  }

  let paid = 0;
  let skipped = 0;
  const errors: { billId: string; message: string }[] = [];

  for (const billId of billIds) {
    try {
      const bill = await prisma.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "ISSUED" && bill.status !== "OVERDUE") {
        skipped++;
        continue;
      }
      // Settle the remaining balance in full: one payment for the outstanding.
      const priorPaid = await prisma.payment.aggregate({ where: { billId }, _sum: { amountCents: true } });
      const outstanding = Math.max(bill.grandTotalCents - (priorPaid._sum.amountCents ?? 0), 0);
      if (outstanding <= 0) {
        skipped++;
        continue;
      }
      await prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: { billId, amountCents: outstanding, paidDate: new Date(), method: null, reference: null, note: "Bulk settle", createdById: admin.id },
        });
        await tx.bill.update({
          where: { id: billId },
          data: { status: "PAID", paidDate: new Date(), paidAmountCents: bill.grandTotalCents },
        });
        await tx.auditLog.create({
          data: {
            actorId: admin.id,
            action: "UPDATE",
            entity: "Bill",
            entityId: billId,
            summary: `Settled ${bill.invoiceNumber || bill.assetCode}: Rs. ${(outstanding / 100).toLocaleString("en-LK")} [bulk]`,
          },
        });
      });
      paid++;
    } catch (err: any) {
      errors.push({ billId, message: err.message || "error" });
    }
  }

  revalidatePath("/billing");
  return { success: true, paid, skipped, errors };
}

// Render and send an invoice PDF to the bill's site contact. Shared by the
// manual "Email invoice" action and the auto-email-on-issue path. Returns a
// discriminated result — { sentTo } on success, { skipped } when it can't send
// for a benign reason (email off, no contact, still a draft), { error } on an
// actual send failure — so callers decide how loudly to surface it.
async function deliverInvoiceEmail(
  billId: string,
  actorId: string | null,
): Promise<{ sentTo?: string; skipped?: string; error?: string }> {
  const { isMailConfigured, sendMail } = await import("@/lib/mail");
  const { renderInvoicePdfBuffer, COMPANY } = await import("@/lib/billing/invoice-document");

  if (!isMailConfigured()) {
    return { skipped: "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the environment." };
  }

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId }, include: { lineItems: true } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status === "DRAFT") return { skipped: "Issue the invoice before emailing it" };

    // Resolve the recipient from the project contact.
    let toEmail: string | null = null;
    let contactName: string | null = null;
    if (bill.projectId) {
      const project = await prisma.project.findUnique({ where: { id: bill.projectId } });
      toEmail = project?.contactEmail || null;
      contactName = project?.contactName || null;
    }
    if (!toEmail) {
      return { skipped: "No contact email on file for this site. Add one on the project before sending." };
    }

    const monthLabel = new Date(bill.year, bill.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
    const grand = "Rs. " + (bill.grandTotalCents / 100).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const due = bill.dueDate ? new Date(bill.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

    const pdf = await renderInvoicePdfBuffer(bill);

    const html = `
      <div style="font-family:Arial,sans-serif;color:#1e293b;max-width:560px;margin:0 auto">
        <div style="background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
          <div style="font-size:16px;font-weight:bold">${COMPANY.name}</div>
          <div style="font-size:11px;color:#93c5fd">${COMPANY.division}</div>
        </div>
        <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
          <p>Dear ${contactName || "Sir/Madam"},</p>
          <p>Please find attached your machine rental invoice <strong>${bill.invoiceNumber}</strong> for <strong>${monthLabel}</strong>.</p>
          <table style="font-size:13px;margin:16px 0">
            <tr><td style="color:#64748b;padding:2px 12px 2px 0">Invoice</td><td><strong>${bill.invoiceNumber}</strong></td></tr>
            <tr><td style="color:#64748b;padding:2px 12px 2px 0">Vehicle</td><td>${bill.assetCode} — ${bill.assetLabel || ""}</td></tr>
            <tr><td style="color:#64748b;padding:2px 12px 2px 0">Amount Due</td><td><strong>${grand}</strong></td></tr>
            <tr><td style="color:#64748b;padding:2px 12px 2px 0">Due Date</td><td>${due}</td></tr>
          </table>
          <p style="font-size:12px;color:#64748b">Thank you for your business.<br/>${COMPANY.name} · ${COMPANY.phone}</p>
        </div>
      </div>`;

    await sendMail({
      to: toEmail,
      subject: `Invoice ${bill.invoiceNumber} — ${COMPANY.name} (${monthLabel})`,
      html,
      text: `Invoice ${bill.invoiceNumber} for ${monthLabel}. Amount due: ${grand}. Due date: ${due}.`,
      attachments: [{ filename: `invoice_${bill.assetCode}_${bill.periodKey}.pdf`, content: pdf, contentType: "application/pdf" }],
    });

    await prisma.bill.update({ where: { id: billId }, data: { emailedAt: new Date(), emailedTo: toEmail } });

    await prisma.auditLog.create({
      data: {
        actorId,
        action: "UPDATE",
        entity: "Bill",
        entityId: billId,
        summary: `Emailed invoice ${bill.invoiceNumber} to ${toEmail}`,
      },
    });

    return { sentTo: toEmail };
  } catch (err: any) {
    console.error("Email invoice error:", err);
    return { error: err.message || "Failed to email invoice" };
  }
}

// Email an invoice PDF to the bill's project/site contact email.
export async function emailInvoiceAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to send invoices" };
  }

  const r = await deliverInvoiceEmail(billId, admin.id);
  if (r.error) return { error: r.error };
  if (r.skipped) return { error: r.skipped };
  revalidatePath(`/billing/${billId}`);
  return { success: true, sentTo: r.sentTo };
}

// Sweep ISSUED bills past their due date to OVERDUE.
export async function markOverdueAction() {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to perform this action" };
  }
  try {
    const count = await sweepOverdueBills();
    revalidatePath("/billing");
    return { success: true, count };
  } catch (err: any) {
    console.error("Mark overdue error:", err);
    return { error: err.message || "Failed to update overdue invoices" };
  }
}

// Update billing.* settings from the admin billing console.
// Set the per-vehicle fuel consumption rate (L/hr or L/km). When a vehicle has
// no meter readings for a billing period, the engine derives the billable units
// from the monthly fuel total ÷ this consumption rate.
export async function updateFuelConsumptionAction(assetId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to update vehicle rates" };
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { code: true, meterType: true } });
  if (!asset) return { error: "Vehicle not found" };

  const parseRate = (v: FormDataEntryValue | null): number | null => {
    const s = v?.toString().trim();
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const fuelConsEcon = parseRate(formData.get("fuelConsEcon"));
  const fuelConsTyp = parseRate(formData.get("fuelConsTyp"));
  const basisRaw = formData.get("fuelConsBasis")?.toString().trim().toLowerCase();
  const fuelConsBasis = basisRaw === "km" ? "km" : basisRaw === "hr" ? "hr" : asset.meterType === "KM" ? "km" : "hr";

  try {
    await prisma.rentalRate.upsert({
      where: { assetId },
      update: { fuelConsEcon, fuelConsTyp, fuelConsBasis },
      create: { assetId, fuelConsEcon, fuelConsTyp, fuelConsBasis },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "RentalRate",
        entityId: assetId,
        summary: `Set fuel consumption rate for ${asset.code}: econ=${fuelConsEcon ?? "—"}, typ=${fuelConsTyp ?? "—"} L/${fuelConsBasis}`,
      },
    });

    revalidatePath(`/fleet/${asset.code}`);
    revalidatePath("/billing");
    return { success: true };
  } catch (err: any) {
    console.error("Update fuel consumption error:", err);
    return { error: err.message || "Failed to update fuel consumption rate" };
  }
}

export async function updateBillingSettingsAction(formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to update billing settings" };
  }

  const enabled = formData.get("enabled") === "true" || formData.get("enabled") === "on" ? "true" : "false";
  const cron = formData.get("cron")?.toString().trim() || "0 3 1 * *";
  const minHours = formData.get("minHours")?.toString().trim() || "120";
  const minKm = formData.get("minKm")?.toString().trim() || "0";
  const minDays = formData.get("minDays")?.toString().trim() || "26";
  const ssclPct = formData.get("ssclPct")?.toString().trim();
  const vatPct = formData.get("vatPct")?.toString().trim();
  const dueDays = formData.get("dueDays")?.toString().trim() || "30";
  const invoicePrefix = formData.get("invoicePrefix")?.toString().trim() || "EC-INV";
  const autoEmailOnIssue = formData.get("autoEmailOnIssue") === "true" || formData.get("autoEmailOnIssue") === "on" ? "true" : "false";

  // Tax fields are entered as percentages in the UI; stored as fractions.
  const ssclRate = ssclPct ? (parseFloat(ssclPct) / 100).toString() : "0.025";
  const vatRate = vatPct ? (parseFloat(vatPct) / 100).toString() : "0.18";

  const entries: { key: string; value: string }[] = [
    { key: "billing.enabled", value: enabled },
    { key: "billing.cron", value: cron },
    { key: "billing.minHours", value: minHours },
    { key: "billing.minKm", value: minKm },
    { key: "billing.minDays", value: minDays },
    { key: "billing.ssclRate", value: ssclRate },
    { key: "billing.vatRate", value: vatRate },
    { key: "billing.dueDays", value: dueDays },
    { key: "billing.invoicePrefix", value: invoicePrefix },
    { key: "billing.autoEmailOnIssue", value: autoEmailOnIssue },
  ];

  try {
    await prisma.$transaction(
      entries.map((e) =>
        prisma.setting.upsert({
          where: { key: e.key },
          update: { value: e.value },
          create: { key: e.key, value: e.value },
        })
      )
    );
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Setting",
        summary: `Updated billing settings (cron=${cron}, SSCL=${ssclRate}, VAT=${vatRate})`,
      },
    });
    revalidatePath("/admin/billing");
    return { success: true };
  } catch (err: any) {
    console.error("Update billing settings error:", err);
    return { error: err.message || "Failed to update billing settings" };
  }
}
