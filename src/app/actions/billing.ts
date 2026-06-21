"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { getBillingConfig } from "@/lib/billing/config";
import { resolvePeriod } from "@/lib/billing/period";
import {
  generateBillsForMonth,
  generateBillForAsset,
  sweepOverdueBills,
} from "@/lib/billing/generate";

const MODES = ["hourly", "perkm", "perday"];
const BASES = ["fw", "w", "d"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

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

  if (!year || !month || month < 1 || month > 12) {
    return { error: "A valid year and month are required" };
  }

  try {
    const result = await generateBillsForMonth({ year, month, regenerate, actorId: admin.id });
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

// Finalize a DRAFT into an ISSUED invoice with a unique invoice number + due date.
export async function finalizeBillAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to issue invoices" };
  }

  try {
    const cfg = await getBillingConfig();
    const invoiceNumber = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({ where: { id: billId } });
      if (!bill) throw new Error("Bill not found");
      if (bill.status !== "DRAFT") throw new Error("Only draft bills can be issued");

      const issuedCount = await tx.bill.count({
        where: { year: bill.year, month: bill.month, invoiceNumber: { not: null } },
      });
      const seq = String(issuedCount + 1).padStart(4, "0");
      const number = `${cfg.invoicePrefix}-${bill.year}-${pad2(bill.month)}-${seq}`;

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
          summary: `Issued invoice ${number} for ${bill.assetCode} (${bill.periodKey})`,
        },
      });
      return number;
    });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true, invoiceNumber };
  } catch (err: any) {
    console.error("Finalize bill error:", err);
    return { error: err.message || "Failed to issue invoice" };
  }
}

// Record payment against an ISSUED / OVERDUE invoice.
export async function markBillPaidAction(billId: string, formData: FormData) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to record payments" };
  }

  const paidLkrStr = formData.get("paidLkr")?.toString() || "";
  const paymentRef = formData.get("paymentRef")?.toString().trim() || null;
  const paymentNote = formData.get("paymentNote")?.toString().trim() || null;
  const paidDateStr = formData.get("paidDate")?.toString() || "";

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status !== "ISSUED" && bill.status !== "OVERDUE") {
      return { error: "Only issued invoices can be marked as paid" };
    }

    // Default the paid amount to the grand total when not supplied.
    const paidAmountCents = paidLkrStr
      ? Math.round(parseFloat(paidLkrStr) * 100)
      : bill.grandTotalCents;
    if (isNaN(paidAmountCents) || paidAmountCents < 0) {
      return { error: "Paid amount must be a valid number" };
    }
    const paidDate = paidDateStr ? new Date(paidDateStr) : new Date();

    await prisma.bill.update({
      where: { id: billId },
      data: { status: "PAID", paidDate, paidAmountCents, paymentRef, paymentNote },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "UPDATE",
        entity: "Bill",
        entityId: billId,
        summary: `Recorded payment for ${bill.invoiceNumber || bill.assetCode}: Rs. ${(paidAmountCents / 100).toLocaleString("en-LK")}`,
      },
    });

    revalidatePath("/billing");
    revalidatePath(`/billing/${billId}`);
    return { success: true };
  } catch (err: any) {
    console.error("Mark bill paid error:", err);
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
        const issuedCount = await tx.bill.count({
          where: { year: bill.year, month: bill.month, invoiceNumber: { not: null } },
        });
        const seq = String(issuedCount + 1).padStart(4, "0");
        const number = `${cfg.invoicePrefix}-${bill.year}-${pad2(bill.month)}-${seq}`;
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
  return { success: true, finalized, skipped, errors };
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
      await prisma.bill.update({
        where: { id: billId },
        data: { status: "PAID", paidDate: new Date(), paidAmountCents: bill.grandTotalCents },
      });
      await prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: "UPDATE",
          entity: "Bill",
          entityId: billId,
          summary: `Recorded full payment for ${bill.invoiceNumber || bill.assetCode}: Rs. ${(bill.grandTotalCents / 100).toLocaleString("en-LK")} [bulk]`,
        },
      });
      paid++;
    } catch (err: any) {
      errors.push({ billId, message: err.message || "error" });
    }
  }

  revalidatePath("/billing");
  return { success: true, paid, skipped, errors };
}

// Email an invoice PDF to the bill's project/site contact email.
export async function emailInvoiceAction(billId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to send invoices" };
  }

  const { isMailConfigured, sendMail } = await import("@/lib/mail");
  const { renderInvoicePdfBuffer, COMPANY } = await import("@/lib/billing/invoice-document");

  if (!isMailConfigured()) {
    return { error: "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in the environment." };
  }

  try {
    const bill = await prisma.bill.findUnique({ where: { id: billId }, include: { lineItems: true } });
    if (!bill) return { error: "Bill not found" };
    if (bill.status === "DRAFT") return { error: "Issue the invoice before emailing it" };

    // Resolve the recipient from the project contact.
    let toEmail: string | null = null;
    let contactName: string | null = null;
    if (bill.projectId) {
      const project = await prisma.project.findUnique({ where: { id: bill.projectId } });
      toEmail = project?.contactEmail || null;
      contactName = project?.contactName || null;
    }
    if (!toEmail) {
      return { error: "No contact email on file for this site. Add one on the project before sending." };
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
        actorId: admin.id,
        action: "UPDATE",
        entity: "Bill",
        entityId: billId,
        summary: `Emailed invoice ${bill.invoiceNumber} to ${toEmail}`,
      },
    });

    revalidatePath(`/billing/${billId}`);
    return { success: true, sentTo: toEmail };
  } catch (err: any) {
    console.error("Email invoice error:", err);
    return { error: err.message || "Failed to email invoice" };
  }
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
