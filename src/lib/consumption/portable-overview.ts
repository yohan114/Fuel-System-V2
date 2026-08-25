// The portable side of the Fuel & Rental Rates screen: the day-hire card, and
// which fleet machines sit on it.
//
// The point of putting the two together is the gap between them. Twenty-one
// portable machines carry the card's DRY figure and nothing in the wet column,
// which is invisible on a per-machine screen and obvious the moment the card is
// beside the fleet: they were priced once, dry, and the wet half was never
// filled in. Bill any of them wet and pickRateCents returns null — no rate, no
// bill, the machine works for nothing.

import { prisma } from "../db";
import {
  PORTABLE_CLASSES,
  cardCategoryForCode,
  guessCardCategory,
  matchPortableClass,
  type PortableClass,
  type PortableMatch,
} from "./portable-rate-card";

export interface PortableMachineRow {
  assetId: string;
  code: string;
  typeLabel: string | null;
  categoryName: string | null;
  projectName: string | null;
  status: string;
  wetCents: number | null;
  dryCents: number | null;
  defaultBasis: string | null;
  /** The card category this machine reads as, from its register labels. */
  cardCategory: string | null;
  /** Which class its current figures sit on, and how well. */
  match: PortableMatch["kind"];
  matchedClassId: string | null;
  /** What the card would charge, if a class could be identified. */
  cardWetCents: number | null;
  cardDryCents: number | null;
}

export interface PortableClassRow extends PortableClass {
  /** Machines currently priced at this class. */
  fleetCount: number;
  codes: string[];
}

export interface PortableOverview {
  classes: PortableClassRow[];
  machines: PortableMachineRow[];
  counts: {
    total: number;
    onCard: number;
    dryOnly: number;
    wetOnly: number;
    offCard: number;
    unpriced: number;
    /** Machines a card class was identified for whose wet rate is unset. */
    fillable: number;
    /** Machines that would bill nothing today, given their own default basis. */
    billsNothing: number;
  };
}

export async function getPortableOverview(): Promise<PortableOverview> {
  const assets = await prisma.asset.findMany({
    where: { rentalRate: { equipType: "PORTABLE" } },
    select: {
      id: true,
      code: true,
      typeLabel: true,
      status: true,
      category: { select: { name: true } },
      project: { select: { name: true } },
      rentalRate: { select: { portDwCents: true, portDdCents: true, defaultBasis: true } },
    },
    orderBy: { code: "asc" },
  });

  const counts = { total: 0, onCard: 0, dryOnly: 0, wetOnly: 0, offCard: 0, unpriced: 0, fillable: 0, billsNothing: 0 };
  const byClass = new Map<string, string[]>();

  const machines: PortableMachineRow[] = assets.map((a) => {
    const wetCents = a.rentalRate?.portDwCents ?? null;
    const dryCents = a.rentalRate?.portDdCents ?? null;
    // The code itself is a signal the register's category field often is not:
    // GE-62 and WG-13 both sit under "Other Asset", and GE-105 has no type
    // label at all, so the prefix is read when the words give nothing.
    const cardCategory =
      guessCardCategory(a.category?.name, a.typeLabel, a.code) ?? cardCategoryForCode(a.code);
    const m = matchPortableClass(wetCents, dryCents, cardCategory);
    const cls = "cls" in m ? m.cls : null;

    counts.total++;
    if (m.kind === "exact") counts.onCard++;
    else if (m.kind === "dry-only") counts.dryOnly++;
    else if (m.kind === "wet-only") counts.wetOnly++;
    else if (m.kind === "off-card") counts.offCard++;
    else counts.unpriced++;
    if (cls && wetCents == null) counts.fillable++;

    // A bill falls to the wet rate unless the machine says otherwise, so a
    // machine defaulting to wet with no wet rate raises nothing.
    const basis = a.rentalRate?.defaultBasis ?? "w";
    if ((basis === "d" ? dryCents : wetCents) == null) counts.billsNothing++;

    if (cls) {
      const list = byClass.get(cls.id) ?? [];
      list.push(a.code);
      byClass.set(cls.id, list);
    }

    return {
      assetId: a.id,
      code: a.code,
      typeLabel: a.typeLabel,
      categoryName: a.category?.name ?? null,
      projectName: a.project?.name ?? null,
      status: a.status,
      wetCents,
      dryCents,
      defaultBasis: a.rentalRate?.defaultBasis ?? null,
      cardCategory,
      match: m.kind,
      matchedClassId: cls?.id ?? null,
      cardWetCents: cls?.wetCents ?? null,
      cardDryCents: cls?.dryCents ?? null,
    };
  });

  const classes: PortableClassRow[] = PORTABLE_CLASSES.map((k) => ({
    ...k,
    fleetCount: byClass.get(k.id)?.length ?? 0,
    codes: byClass.get(k.id) ?? [],
  }));

  // Machines needing attention first; the rest by code.
  const RANK: Record<string, number> = { unpriced: 0, "dry-only": 1, "wet-only": 2, "off-card": 3, exact: 4 };
  machines.sort((a, b) => (RANK[a.match] ?? 9) - (RANK[b.match] ?? 9) || a.code.localeCompare(b.code));

  return { classes, machines, counts };
}
