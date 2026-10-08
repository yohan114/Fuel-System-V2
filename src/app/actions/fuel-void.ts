"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { logFuelIssueChange, periodKeyFor } from "@/lib/fuel/audit";
import { resolvePeriod } from "@/lib/billing/period";
import { generateBillForAsset } from "@/lib/billing/generate";
import { adjustTankStockAtomically } from "@/lib/fuel/stock-guard";
import { executeVoidFuelIssue } from "@/lib/commands";

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

/**
 * What has been done to one issue.
 *
 * Fetched when the trail is opened, not with the page. The log shows a thousand
 * rows at a time and twenty thousand under a pump filter; asking for every
 * row's history up front put one bound parameter per id into the query and went
 * straight past SQLite's limit, which took the whole page down with a server
 * error. One issue at a time costs one parameter.
 */
export async function fuelIssueHistoryAction(issueId: string) {
  try {
    await assertCan("manage");
  } catch {
    return { error: "You are not authorized to read this" };
  }

  const entries = await prisma.auditLog.findMany({
    where: { entity: "FuelIssue", entityId: issueId },
    select: { createdAt: true, summary: true, actor: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return {
    success: true,
    entries: entries.map((e) => ({
      at: e.createdAt.toISOString(),
      who: e.actor?.name ?? null,
      summary: e.summary,
    })),
  };
}

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

  const result = await executeVoidFuelIssue(
    { issueId, reason: reason ?? "", voided },
    {
      actorId: admin.id,
      actorName: admin.name,
      role: admin.role,
      projectId: admin.projectId,
    }
  );

  if (!result.success) {
    return { error: result.error };
  }

  revalidatePath("/fuel/issues");
  revalidatePath("/billing");
  revalidatePath(`/fleet/${result.data.assetCode}`);
  if (result.data.tankDeltaLitres) revalidatePath("/workshop");

  return {
    success: true,
    message: result.message,
  };
}

/** Take it out of the books. */
export async function voidFuelIssueAction(issueId: string, reason: string) {
  return setVoided(issueId, true, reason);
}

/** Put it back. */
export async function restoreFuelIssueAction(issueId: string, reason?: string) {
  return setVoided(issueId, false, reason ?? null);
}
