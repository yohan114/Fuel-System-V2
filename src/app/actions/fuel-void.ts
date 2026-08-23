"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { logFuelIssueChange, periodKeyFor } from "@/lib/fuel/audit";
import { resolvePeriod } from "@/lib/billing/period";
import { generateBillForAsset } from "@/lib/billing/generate";

// Taking a fuel issue out of the books, and putting it back.
//
// "Delete" here does not erase. The row stays, flagged, and drops out of every
// total, bill and report — which is the only version of deleting that leaves
// the audit entry with something to point at, allows an undo, and survives a
// re-import: a dedup pass cannot recognise a row that is not there, so an
// erased issue comes straight back the next time the sheet is loaded.
//
// Three things follow from voiding a litre, and all three happen here:
//   the tank gets it back
//   the meter reading the issue carried stops counting
//   the month's bill is redone, because fuel is what qualifies a machine to be
//   billed at all and what its hours are derived from

/** What voiding this issue would do, in figures, before anyone commits to it. */
export async function previewVoidFuelIssueAction(issueId: string) {
  try {
    await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change fuel issues" };
  }

  const issue = await prisma.fuelIssue.findUnique({
    where: { id: issueId },
    include: {
      asset: { select: { code: true, regNo: true } },
      bulkTank: { select: { id: true, name: true, balance: true } },
    },
  });
  if (!issue) return { error: "Fuel issue not found" };

  const periodKey = periodKeyFor(issue.issueDate);
  const [y, m] = periodKey.split("-").map(Number);

  const bill = await prisma.bill.findUnique({
    where: { assetId_year_month: { assetId: issue.assetId, year: y, month: m } },
    select: { status: true, invoiceNumber: true, grandTotalCents: true, fuelLitres: true, projectCode: true },
  });

  // Would this be the machine's last fuel that month? If so the bill goes
  // entirely, not just its fuel line — that is the rule the generator applies.
  //
  // Bounds from resolvePeriod, not hand-rolled: a Colombo month starts at
  // 18:30Z on the last day of the month before, and every place in this system
  // that has computed those dates by hand has got them wrong at least once.
  const period = resolvePeriod(y, m);
  const others = await prisma.fuelIssue.count({
    where: {
      assetId: issue.assetId,
      voided: false,
      id: { not: issue.id },
      issueDate: { gte: period.start, lte: period.end },
    },
  });

  return {
    success: true,
    preview: {
      assetCode: issue.asset.code,
      litres: issue.litres,
      costCents: issue.totalCost,
      alreadyVoided: issue.voided,
      tankName: issue.bulkTank?.name ?? null,
      tankBalanceAfter: issue.bulkTank ? issue.bulkTank.balance + issue.litres : null,
      hasMeterReading: issue.meterReadingRecordId != null,
      periodKey,
      billStatus: bill?.status ?? null,
      billInvoiceNumber: bill?.invoiceNumber ?? null,
      billSite: bill?.projectCode ?? null,
      billTotalCents: bill?.grandTotalCents ?? null,
      lastFuelOfMonth: others === 0,
    },
  };
}

async function setVoided(issueId: string, voided: boolean, reason: string | null) {
  let admin;
  try {
    admin = await assertCan("manage");
    if (admin.role !== "ADMIN") return { error: "Only an administrator may void a fuel issue" };
  } catch {
    return { error: "You are not authorized to change fuel issues" };
  }

  const trimmed = (reason ?? "").trim();
  if (voided && trimmed.length < 4) {
    return { error: "Give a reason for voiding this issue — it goes on the record." };
  }

  try {
    const issue = await prisma.fuelIssue.findUnique({
      where: { id: issueId },
      include: {
        asset: { select: { id: true, code: true } },
        bulkTank: { select: { id: true, name: true, balance: true } },
      },
    });
    if (!issue) return { error: "Fuel issue not found" };
    if (issue.voided === voided) {
      return { error: voided ? "That issue is already voided." : "That issue is not voided." };
    }

    const periodKey = periodKeyFor(issue.issueDate);
    const [y, m] = periodKey.split("-").map(Number);

    // An invoice the client already holds does not quietly lose its fuel.
    const bill = await prisma.bill.findUnique({
      where: { assetId_year_month: { assetId: issue.assetId, year: y, month: m } },
      select: { status: true, invoiceNumber: true },
    });
    if (bill && bill.status !== "DRAFT") {
      return {
        error:
          `${issue.asset.code}'s ${periodKey} invoice is ${bill.status}` +
          `${bill.invoiceNumber ? ` (${bill.invoiceNumber})` : ""} and has gone to the client. ` +
          `Raise a credit note rather than voiding the fuel behind it.`,
      };
    }

    // Voiding returns the litres to the tank; restoring takes them out again.
    const delta = voided ? issue.litres : -issue.litres;
    if (!voided && issue.bulkTank && issue.bulkTank.balance < issue.litres) {
      return {
        error:
          `${issue.bulkTank.name} holds ${issue.bulkTank.balance.toFixed(1)} L, ` +
          `less than the ${issue.litres} L restoring this issue would take back out.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.fuelIssue.update({
        where: { id: issue.id },
        data: { voided, voidedAt: voided ? new Date() : null },
      });

      if (issue.bulkTankId) {
        await tx.bulkTank.update({
          where: { id: issue.bulkTankId },
          data: { balance: { increment: delta } },
        });
      }

      await logFuelIssueChange(tx, admin.id, issue.asset.code, {
        action: voided ? "VOID" : "UNVOID",
        issueId: issue.id,
        changes: [{ field: "voided", from: !voided, to: voided }],
        tankDeltaLitres: issue.bulkTankId ? delta : undefined,
        tankId: issue.bulkTankId,
        tankName: issue.bulkTank?.name ?? null,
        // The MeterReading row is deliberately left alone. It is a reading of
        // the machine, true whether or not the litres beside it were, and the
        // billing engine's own coherence checks decide what to make of it.
        meterReading: "unchanged",
        periodKey,
        reason: trimmed || null,
      });
    });

    // Redo the one bill this touches, so the figure on screen is the figure
    // that was just decided rather than one that waits for a monthly run.
    let billNote = "";
    try {
      const r = await generateBillForAsset(issue.assetId, resolvePeriod(y, m), {
        regenerate: true,
        actorId: admin.id,
      });
      if (r.status === "skipped-not-here") {
        billNote = ` Its ${periodKey} draft bill was removed — no fuel left that month.`;
      } else if (r.status === "regenerated" || r.status === "created") {
        billNote = ` Its ${periodKey} draft bill was redone.`;
      }
    } catch (err) {
      console.error("Bill regeneration after void failed:", err);
      billNote = ` The ${periodKey} bill could not be redone automatically — regenerate the month.`;
    }

    revalidatePath("/fuel/issues");
    revalidatePath("/billing");
    revalidatePath(`/fleet/${issue.asset.code}`);
    if (issue.bulkTankId) revalidatePath("/workshop");

    return {
      success: true,
      message:
        `${issue.asset.code}'s ${issue.litres} L issue ${voided ? "voided" : "restored"}.` +
        (issue.bulkTank ? ` ${Math.abs(delta)} L ${voided ? "returned to" : "taken from"} ${issue.bulkTank.name}.` : "") +
        billNote,
    };
  } catch (err: unknown) {
    console.error("Void fuel issue error:", err);
    return { error: errorMessage(err) || "Failed to change the fuel issue" };
  }
}

/** Take it out of the books. */
export async function voidFuelIssueAction(issueId: string, reason: string) {
  return setVoided(issueId, true, reason);
}

/** Put it back. */
export async function restoreFuelIssueAction(issueId: string, reason?: string) {
  return setVoided(issueId, false, reason ?? null);
}
