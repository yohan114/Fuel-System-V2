"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { resolvePeriod } from "@/lib/billing/period";
import { generateBillForAsset } from "@/lib/billing/generate";
import { errorMessage } from "@/lib/errors";

// Putting a vehicle on a site's bill, or taking one off it.
//
// The generator decides from the records and is right nearly always. These are
// for when it is not, and the office knows something the records do not: a small
// item that was never registered, plant that stood on a client's site all month
// and burnt nothing, a vehicle a site says was never theirs.
//
// Every one of these writes a BillingSiteOverride and then regenerates the one
// bill it affects, so the figure on screen is the figure that was just decided
// rather than one that appears after somebody remembers to re-run the month.

function periodOf(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return resolvePeriod(y, m);
}

/** Regenerate the single bill an override touches, so the change is visible at once. */
async function regenerate(assetId: string, periodKey: string, actorId: string) {
  const period = periodOf(periodKey);
  if (!period) return null;
  return generateBillForAsset(assetId, period, { regenerate: true, actorId });
}

/**
 * What the generator did, in words.
 *
 * An add that produces no bill is the failure worth naming: the machine has no
 * rate card, so there is nothing to price it at, and the button would otherwise
 * look like it had done nothing at all.
 */
function outcomeNote(status: string | undefined, code: string): string {
  switch (status) {
    case "created":
    case "regenerated":
      return "";
    case "no-rate":
      return ` But ${code} has no rate card, so nothing can be charged yet — give it a rate, or add it as fuel-only to charge the diesel alone.`;
    case "skipped-billed-direct":
      return ` But ${code} is settled direct with its owner, so E&C bills it nothing.`;
    case "skipped-finalized":
      return ` Its bill has already been issued and was left untouched.`;
    case "skipped-not-here":
      return ` The generator still finds no evidence it was here — check the posting dates.`;
    default:
      return "";
  }
}

/**
 * Bill this vehicle to this site for this month.
 *
 * A reason is required whenever the vehicle drew no fuel at the site, because
 * that overrules the standing rule that diesel is what proves a machine worked
 * somewhere. Six months from now the reason is the only thing that explains why
 * a machine with no diesel was charged a full month's minimum.
 *
 * It also writes a MANUAL posting for the month. The override is what survives
 * regeneration and carries the reason; the posting is what gives the bill its
 * days on site, and MANUAL is the origin the fuel-driven rebuild leaves alone.
 */
export async function addVehicleToSiteBillingAction(input: {
  assetId: string;
  projectId: string;
  periodKey: string;
  reason?: string;
  /**
   * Charge the diesel and no rental. For the items that draw fuel and were never
   * priced — a site's own generator, a subcontractor's set E&C refuels.
   */
  fuelOnly?: boolean;
}) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change billing" };
  }

  const period = periodOf(input.periodKey);
  if (!period) return { error: "A valid month is required" };

  try {
    const [asset, project] = await Promise.all([
      prisma.asset.findUnique({ where: { id: input.assetId }, select: { id: true, code: true, billFuelOnly: true } }),
      prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, code: true } }),
    ]);
    if (!asset) return { error: "Vehicle not found" };
    if (!project) return { error: "Site not found" };

    // Charge the diesel and no rental. The flag is the system's own answer for a
    // machine E&C fuels but does not rent, and it is what makes an add stick for
    // an item nobody ever priced. Whether THIS add is what set it is recorded on
    // the override, so undoing the override puts it back.
    const flippedFuelOnly = !!input.fuelOnly && !asset.billFuelOnly;
    if (flippedFuelOnly) {
      await prisma.asset.update({ where: { id: asset.id }, data: { billFuelOnly: true } });
    }

    const fuelHere = await prisma.fuelIssue.count({
      where: {
        assetId: asset.id,
        voided: false,
        issueDate: { gte: period.start, lte: period.end },
        bulkTank: { projectId: project.id },
      },
    });

    const reason = (input.reason ?? "").trim();
    if (fuelHere === 0 && reason.length < 4) {
      return {
        error: `${asset.code} drew no fuel from ${project.name} in ${input.periodKey}. Give a reason for billing it anyway.`,
      };
    }

    await prisma.billingSiteOverride.upsert({
      where: { projectId_periodKey_assetId: { projectId: project.id, periodKey: input.periodKey, assetId: asset.id } },
      create: {
        projectId: project.id, assetId: asset.id, periodKey: input.periodKey,
        action: "ADD", reason: reason || null, createdById: admin.id, setFuelOnly: flippedFuelOnly,
      },
      // An earlier add may already own the flag; don't lose that on a re-add.
      update: {
        action: "ADD", reason: reason || null, createdById: admin.id,
        ...(flippedFuelOnly ? { setFuelOnly: true } : {}),
      },
    });

    // A posting covering the month, unless one already covers part of it — the
    // machine may genuinely have been here for a fortnight and the bill should
    // say a fortnight, not a month.
    const covering = await prisma.assetAssignment.findFirst({
      where: {
        assetId: asset.id, projectId: project.id,
        startDate: { lte: period.end },
        OR: [{ endDate: null }, { endDate: { gte: period.start } }],
      },
    });
    if (!covering) {
      await prisma.assetAssignment.create({
        data: {
          assetId: asset.id, projectId: project.id,
          startDate: period.start, endDate: period.end,
          origin: "MANUAL",
          note: `Added to ${project.code} billing for ${input.periodKey}${reason ? ` — ${reason}` : ""}`,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "BillingSiteOverride", entityId: asset.id,
        summary:
          `Added ${asset.code} to ${project.code} billing for ${input.periodKey}` +
          (fuelHere === 0 ? ` — no fuel drawn here; reason: ${reason}` : ` (${fuelHere} fuel issue${fuelHere === 1 ? "" : "s"} here)`),
      },
    });

    const gen = await regenerate(asset.id, input.periodKey, admin.id);
    revalidatePath("/billing");
    return {
      success: true,
      message:
        `${asset.code} added to ${project.name} for ${input.periodKey}.` +
        outcomeNote(gen?.status, asset.code),
    };
  } catch (err: unknown) {
    console.error("Add vehicle to site billing error:", err);
    return { error: errorMessage(err) || "Failed to add the vehicle" };
  }
}

/**
 * Take this vehicle off this site's bill for this month.
 *
 * An ISSUED invoice is never touched: it has gone to the client and is corrected
 * by a credit note, not by disappearing. Where the machine worked several sites,
 * only this site's segment drops out and the others are billed as before.
 */
export async function removeVehicleFromSiteBillingAction(input: {
  assetId: string;
  projectId: string;
  periodKey: string;
  reason?: string;
}) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change billing" };
  }

  const period = periodOf(input.periodKey);
  if (!period) return { error: "A valid month is required" };

  try {
    const [asset, project] = await Promise.all([
      prisma.asset.findUnique({ where: { id: input.assetId }, select: { id: true, code: true } }),
      prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, code: true } }),
    ]);
    if (!asset) return { error: "Vehicle not found" };
    if (!project) return { error: "Site not found" };

    const existing = await prisma.bill.findUnique({
      where: { assetId_year_month: { assetId: asset.id, year: period.year, month: period.month } },
      select: { status: true, invoiceNumber: true },
    });
    if (existing && existing.status !== "DRAFT") {
      return {
        error:
          `${asset.code}'s ${input.periodKey} bill is ${existing.status}` +
          `${existing.invoiceNumber ? ` (${existing.invoiceNumber})` : ""} and has gone to the client. ` +
          `Raise a credit note instead of removing it.`,
      };
    }

    const reason = (input.reason ?? "").trim();
    await prisma.billingSiteOverride.upsert({
      where: { projectId_periodKey_assetId: { projectId: project.id, periodKey: input.periodKey, assetId: asset.id } },
      create: {
        projectId: project.id, assetId: asset.id, periodKey: input.periodKey,
        action: "REMOVE", reason: reason || null, createdById: admin.id,
      },
      update: { action: "REMOVE", reason: reason || null, createdById: admin.id },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "DELETE", entity: "BillingSiteOverride", entityId: asset.id,
        summary: `Removed ${asset.code} from ${project.code} billing for ${input.periodKey}${reason ? ` — ${reason}` : ""}`,
      },
    });

    await regenerate(asset.id, input.periodKey, admin.id);
    revalidatePath("/billing");
    return { success: true, message: `${asset.code} removed from ${project.name} for ${input.periodKey}.` };
  } catch (err: unknown) {
    console.error("Remove vehicle from site billing error:", err);
    return { error: errorMessage(err) || "Failed to remove the vehicle" };
  }
}

/** Undo a decision and let the records speak for themselves again. */
export async function clearSiteBillingOverrideAction(overrideId: string) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change billing" };
  }

  try {
    const o = await prisma.billingSiteOverride.findUnique({
      where: { id: overrideId },
      include: { asset: { select: { id: true, code: true } }, project: { select: { code: true } } },
    });
    if (!o) return { error: "That decision has already been undone" };

    await prisma.billingSiteOverride.delete({ where: { id: overrideId } });
    // Put the machine back as it was found. Only where this override is what
    // changed it — a flag set deliberately elsewhere is not ours to clear.
    if (o.setFuelOnly) {
      await prisma.asset.update({ where: { id: o.assetId }, data: { billFuelOnly: false } });
    }
    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "DELETE", entity: "BillingSiteOverride", entityId: o.assetId,
        summary:
          `Cleared the ${o.action} on ${o.asset.code} for ${o.project.code} ${o.periodKey}` +
          (o.setFuelOnly ? " and put it back off fuel-only" : ""),
      },
    });

    await regenerate(o.assetId, o.periodKey, admin.id);
    revalidatePath("/billing");
    return { success: true, message: `Cleared. ${o.asset.code} follows the records again.` };
  } catch (err: unknown) {
    console.error("Clear billing override error:", err);
    return { error: errorMessage(err) || "Failed to clear the decision" };
  }
}

/**
 * Register a small item that was never in the fleet, and put it on this site's
 * bill for this month.
 *
 * The reason this exists: sites run poker vibrators, rammers, grass cutters and
 * light towers that draw diesel and were never entered anywhere, so nothing in
 * the system can charge for them. Created fuel-only by default — most such items
 * carry no rate and are billed for the diesel they burn.
 */
export async function createAndAddVehicleAction(input: {
  code: string;
  description?: string;
  projectId: string;
  periodKey: string;
  meterType?: string;
  /** Rupees per day. Blank/0 means fuel-only: charge the diesel, no rental. */
  dayRateRupees?: number;
  reason?: string;
}) {
  let admin;
  try {
    admin = await assertCan("manage");
  } catch {
    return { error: "You are not authorized to change billing" };
  }

  const code = (input.code ?? "").trim().toUpperCase();
  if (code.length < 2) return { error: "A code of at least two characters is required" };

  const period = periodOf(input.periodKey);
  if (!period) return { error: "A valid month is required" };

  try {
    const clash = await prisma.asset.findFirst({ where: { code }, select: { id: true, code: true } });
    if (clash) {
      return { error: `${clash.code} is already in the fleet — add it from the list instead of creating it again.` };
    }
    const project = await prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true, code: true } });
    if (!project) return { error: "Site not found" };

    // Whatever the fleet already uses for odds and ends, so these land beside
    // the other unregistered items rather than inventing a category per item.
    const category =
      (await prisma.category.findFirst({ where: { name: { contains: "Other" } }, select: { id: true } })) ??
      (await prisma.category.findFirst({ select: { id: true } }));
    if (!category) return { error: "No asset category exists to file this under" };

    const dayRate = Math.round((input.dayRateRupees ?? 0) * 100);
    const asset = await prisma.asset.create({
      data: {
        code,
        typeLabel: (input.description ?? "").trim() || "Site item — added from billing",
        meterType: input.meterType === "KM" || input.meterType === "HOURS" ? input.meterType : "NONE",
        categoryId: category.id,
        status: "ACTIVE",
        // No day rate means the item earns nothing but its diesel, which is the
        // usual arrangement for a poker or a rammer.
        billFuelOnly: dayRate === 0,
        ...(dayRate > 0
          ? { rentalRate: { create: { equipType: "PORTABLE", portDdCents: dayRate, defaultBasis: "d", sourceLabel: `Added from ${project.code} billing ${input.periodKey}` } } }
          : {}),
      },
      select: { id: true, code: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "CREATE", entity: "Asset", entityId: asset.id,
        summary:
          `Created ${asset.code} from ${project.code} billing for ${input.periodKey}` +
          (dayRate > 0 ? ` at Rs ${(dayRate / 100).toLocaleString("en-LK")}/day dry` : " as fuel-only"),
      },
    });

    // A brand-new item has drawn no fuel yet, so the add needs a reason. Its own
    // creation is one.
    return addVehicleToSiteBillingAction({
      assetId: asset.id,
      projectId: project.id,
      periodKey: input.periodKey,
      reason: (input.reason ?? "").trim() || `Registered from ${project.code} billing — not previously in the fleet`,
    });
  } catch (err: unknown) {
    console.error("Create and add vehicle error:", err);
    return { error: errorMessage(err) || "Failed to create the item" };
  }
}
