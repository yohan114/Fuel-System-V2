"use server";

import { prisma } from "@/lib/db";
import { assertCan } from "@/lib/rbac";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/errors";
import { rateFieldFor } from "@/lib/consumption/rates-overview";
import { getPortableOverview } from "@/lib/consumption/portable-overview";
import { portableClassById } from "@/lib/consumption/portable-rate-card";

// Editing a machine's hire rate from the rates screen.
//
// The three tiers are one commercial decision — dry, wet, fully wet — and they
// were only editable one machine at a time on the fleet page, which is why the
// fleet drifted into 179 machines with no rate at all and a dozen priced at
// zero. Setting them where you can see the whole fleet, and see what each
// machine actually burns beside the price, is the point.
//
// Which columns a machine reads is decided by its own billing mode: an hourly
// machine on hrDCents/hrWCents/hrFwCents, a road vehicle on the km trio,
// portable plant on its two day columns. Writing a figure into the wrong one is
// silent — the bill simply keeps the old rate — so the field is resolved from
// the same helper the table displays from.

export async function setMachineRateAction(input: {
  assetId: string;
  tier: "d" | "w" | "fw";
  /** Rupees as typed. Empty or null clears the tier. */
  rupees: number | null;
}) {
  let admin;
  try {
    admin = await assertCan("manage");
    if (admin.role !== "ADMIN") return { error: "Only an administrator may change rates" };
  } catch {
    return { error: "You are not authorized to change rates" };
  }

  if (input.rupees != null && (!Number.isFinite(input.rupees) || input.rupees < 0)) {
    return { error: "A rate cannot be negative" };
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: input.assetId },
      select: { id: true, code: true, meterType: true, rentalRate: true },
    });
    if (!asset) return { error: "Machine not found" };

    const equipType = asset.rentalRate?.equipType ?? "FLEET";
    const mode = equipType === "PORTABLE" ? "perday" : asset.meterType === "KM" ? "perkm" : "hourly";
    const field = rateFieldFor(mode, input.tier, equipType === "PORTABLE");
    if (!field) {
      return { error: "Portable plant has no fully-wet tier — it is priced dry or wet by the day." };
    }

    const cents = input.rupees == null ? null : Math.round(input.rupees * 100);
    const before = asset.rentalRate ? (asset.rentalRate as unknown as Record<string, number | null>)[field] : null;
    if (before === cents) return { success: true, message: "No change." };

    if (asset.rentalRate) {
      await prisma.rentalRate.update({ where: { assetId: asset.id }, data: { [field]: cents } });
    } else {
      // A machine with no card gets one rather than silently refusing the edit;
      // an unpriced machine is exactly the case this screen exists to fix.
      await prisma.rentalRate.create({
        data: { assetId: asset.id, equipType, [field]: cents, sourceLabel: "Set from the rates screen" } as never,
      });
    }

    const rs = (c: number | null) => (c == null ? "—" : "Rs " + (c / 100).toLocaleString("en-LK"));
    const tierName = { d: "dry", w: "wet", fw: "fully wet" }[input.tier];
    const unit = mode === "perkm" ? "/km" : mode === "perday" ? "/day" : "/hr";

    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "RentalRate", entityId: asset.id,
        summary: `${asset.code} ${tierName} rate ${rs(before)}${unit} → ${rs(cents)}${unit}`,
        metaJson: JSON.stringify({ assetCode: asset.code, field, from: before, to: cents, mode, tier: input.tier }),
      },
    });

    revalidatePath("/rates");
    revalidatePath(`/fleet/${asset.code}`);
    return { success: true, message: `${asset.code} ${tierName} set to ${rs(cents)}${unit}.` };
  } catch (err: unknown) {
    console.error("Set machine rate error:", err);
    return { error: errorMessage(err) || "Failed to save the rate" };
  }
}

/** Which tier a machine's bills fall to when nothing else decides. */
export async function setMachineDefaultBasisAction(assetId: string, basis: "d" | "w" | "fw") {
  let admin;
  try {
    admin = await assertCan("manage");
    if (admin.role !== "ADMIN") return { error: "Only an administrator may change rates" };
  } catch {
    return { error: "You are not authorized to change rates" };
  }

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: assetId },
      select: { code: true, rentalRate: { select: { defaultBasis: true } } },
    });
    if (!asset) return { error: "Machine not found" };
    if (!asset.rentalRate) return { error: "Set a rate first — there is no card to put a default on." };
    if (asset.rentalRate.defaultBasis === basis) return { success: true, message: "No change." };

    await prisma.rentalRate.update({ where: { assetId }, data: { defaultBasis: basis } });
    const name = { d: "dry", w: "wet", fw: "fully wet" }[basis];
    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "RentalRate", entityId: assetId,
        summary: `${asset.code} now bills ${name} by default (was ${asset.rentalRate.defaultBasis ?? "unset"})`,
      },
    });

    revalidatePath("/rates");
    return {
      success: true,
      // A posting marked DRY still overrides this, and saying so here saves the
      // next person wondering why the bill did not move.
      message: `${asset.code} defaults to ${name}. A posting marked otherwise still wins for its own days.`,
    };
  } catch (err: unknown) {
    console.error("Set default basis error:", err);
    return { error: errorMessage(err) || "Failed to save the default" };
  }
}

// ── portable day-hire card ──────────────────────────────────────────────────
//
// Portable plant is priced from a capacity class, not machine by machine: a
// 20–25 kVA generator is Rs 12,000 wet and Rs 6,000 dry whichever generator it
// is. Applying a class copies the card's two figures onto the machine, which is
// the same thing somebody would otherwise do by typing them into the two cells.
//
// It changes nothing already invoiced. Rates are read when a bill is generated,
// so an issued bill keeps the figure it was raised at; a draft picks the new one
// up the next time its month is regenerated.

async function assertAdmin() {
  const admin = await assertCan("manage");
  if (admin.role !== "ADMIN") throw new Error("Only an administrator may change rates");
  return admin;
}

export async function applyPortableClassAction(input: {
  assetId: string;
  classId: string;
  /** "both" overwrites the pair; "fill" only writes a tier that is currently unset. */
  mode?: "both" | "fill";
}) {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { error: "You are not authorized to change rates" };
  }

  const cls = portableClassById(input.classId);
  if (!cls) return { error: "That is not a class on the 2026 portable card" };

  try {
    const asset = await prisma.asset.findUnique({
      where: { id: input.assetId },
      select: {
        id: true, code: true,
        rentalRate: { select: { equipType: true, portDwCents: true, portDdCents: true } },
      },
    });
    if (!asset) return { error: "Machine not found" };
    if (asset.rentalRate && asset.rentalRate.equipType !== "PORTABLE") {
      // The card is per-day; a machine billing hourly would take the figures
      // and never read them.
      return { error: `${asset.code} is not portable plant — the day-hire card does not apply to it.` };
    }

    const fill = input.mode === "fill";
    const beforeWet = asset.rentalRate?.portDwCents ?? null;
    const beforeDry = asset.rentalRate?.portDdCents ?? null;
    const wet = fill && beforeWet != null ? beforeWet : cls.wetCents;
    const dry = fill && beforeDry != null ? beforeDry : cls.dryCents;
    if (wet === beforeWet && dry === beforeDry) return { success: true, message: "No change." };

    if (asset.rentalRate) {
      await prisma.rentalRate.update({
        where: { assetId: asset.id },
        data: { portDwCents: wet, portDdCents: dry },
      });
    } else {
      await prisma.rentalRate.create({
        data: {
          assetId: asset.id, equipType: "PORTABLE",
          portDwCents: wet, portDdCents: dry,
          sourceLabel: `2026 portable card · ${cls.category} · ${cls.size}`,
        } as never,
      });
    }

    const rs = (c: number | null) => (c == null ? "—" : "Rs " + (c / 100).toLocaleString("en-LK"));
    await prisma.auditLog.create({
      data: {
        actorId: admin.id, action: "UPDATE", entity: "RentalRate", entityId: asset.id,
        summary:
          `${asset.code} put on the ${cls.category} ${cls.size} day-hire class — ` +
          `wet ${rs(beforeWet)} → ${rs(wet)}/day, dry ${rs(beforeDry)} → ${rs(dry)}/day`,
        metaJson: JSON.stringify({
          assetCode: asset.code, classId: cls.id, mode: input.mode ?? "both",
          from: { portDwCents: beforeWet, portDdCents: beforeDry },
          to: { portDwCents: wet, portDdCents: dry },
        }),
      },
    });

    revalidatePath("/rates");
    revalidatePath(`/fleet/${asset.code}`);
    return {
      success: true,
      message: `${asset.code}: ${rs(wet)} wet / ${rs(dry)} dry per day. Bills already issued keep their old rate.`,
    };
  } catch (err: unknown) {
    console.error("Apply portable class error:", err);
    return { error: errorMessage(err) || "Failed to apply the class" };
  }
}

/**
 * Fill in the wet rate for every portable machine that has a dry rate on a
 * recognised class and no wet rate at all.
 *
 * This is the gap the card exposes: those machines were priced once, dry, and
 * the wet half was never entered — so hiring one out wet prices at nothing and
 * raises no bill. It only ever writes a tier that is empty; nothing already set
 * is touched, and a machine whose class cannot be identified is left alone and
 * reported rather than guessed at.
 */
export async function fillMissingPortableWetAction() {
  let admin;
  try {
    admin = await assertAdmin();
  } catch {
    return { error: "You are not authorized to change rates" };
  }

  try {
    const { machines } = await getPortableOverview();
    const targets = machines.filter((m) => m.wetCents == null && m.cardWetCents != null);
    if (targets.length === 0) return { success: true, message: "Every portable machine already has a wet rate.", filled: 0 };

    for (const m of targets) {
      await prisma.$transaction([
        prisma.rentalRate.update({ where: { assetId: m.assetId }, data: { portDwCents: m.cardWetCents } }),
        prisma.auditLog.create({
          data: {
            actorId: admin.id, action: "UPDATE", entity: "RentalRate", entityId: m.assetId,
            summary:
              `${m.code} wet day rate set to Rs ${(m.cardWetCents! / 100).toLocaleString("en-LK")}/day ` +
              `from the 2026 portable card (was unset; dry rate unchanged)`,
            metaJson: JSON.stringify({
              assetCode: m.code, classId: m.matchedClassId, bulk: "fill-missing-portable-wet",
              from: { portDwCents: null }, to: { portDwCents: m.cardWetCents },
            }),
          },
        }),
      ]);
    }

    revalidatePath("/rates");
    const skipped = machines.filter((m) => m.wetCents == null && m.cardWetCents == null);
    return {
      success: true,
      filled: targets.length,
      message:
        `Wet rate filled in for ${targets.length} machine${targets.length === 1 ? "" : "s"} from the card.` +
        (skipped.length ? ` ${skipped.length} left alone — no class could be identified for them.` : ""),
    };
  } catch (err: unknown) {
    console.error("Fill portable wet rates error:", err);
    return { error: errorMessage(err) || "Failed to fill the wet rates" };
  }
}
