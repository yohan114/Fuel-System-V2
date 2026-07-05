import { prisma } from "../db";
import { planMerges, detailScore } from "../fleet/dedupe";

// Cross-cutting invariant checks for /admin/data-quality. Each check verifies
// something the rest of the system assumes to be true; a failure means data
// needs repair, not that a page is broken.

export interface InvariantCheck {
  key: string;
  name: string;
  description: string;
  count: number; // number of offending rows (0 = pass)
  samples: string[]; // up to 5 identifiers for quick triage
}

export async function runInvariantChecks(): Promise<InvariantCheck[]> {
  const checks: InvariantCheck[] = [];

  // 1. Invoice numbers must be unique (DB enforces; catches manual imports).
  const dupInvoices = await prisma.$queryRawUnsafe<{ invoiceNumber: string; n: number }[]>(
    `SELECT invoiceNumber, COUNT(*) n FROM Bill WHERE invoiceNumber IS NOT NULL GROUP BY invoiceNumber HAVING n > 1 LIMIT 6`
  );
  checks.push({
    key: "dup-invoices",
    name: "Duplicate invoice numbers",
    description: "Every issued invoice number must identify exactly one bill.",
    count: dupInvoices.length,
    samples: dupInvoices.slice(0, 5).map((r) => r.invoiceNumber),
  });

  // 2. One vehicle cannot be posted to two sites at once.
  const assignments = await prisma.assetAssignment.findMany({
    orderBy: [{ assetId: "asc" }, { startDate: "asc" }],
    select: { assetId: true, startDate: true, endDate: true, asset: { select: { code: true } } },
  });
  const overlapSamples: string[] = [];
  let overlapCount = 0;
  for (let i = 1; i < assignments.length; i++) {
    const prev = assignments[i - 1];
    const cur = assignments[i];
    if (prev.assetId !== cur.assetId) continue;
    const prevEnd = prev.endDate ? prev.endDate.getTime() : Infinity;
    if (cur.startDate.getTime() <= prevEnd) {
      overlapCount++;
      if (overlapSamples.length < 5) overlapSamples.push(prev.asset.code);
    }
  }
  checks.push({
    key: "overlapping-assignments",
    name: "Overlapping assignments",
    description: "Assignment periods for one vehicle must not overlap (billing splits months along them).",
    count: overlapCount,
    samples: overlapSamples,
  });

  // 3. Cumulative meters must not run backwards.
  const rollbacks = await prisma.$queryRawUnsafe<{ code: string; n: number }[]>(
    `SELECT a.code, COUNT(*) n FROM (
       SELECT assetId, value - LAG(value) OVER (PARTITION BY assetId, readingType ORDER BY readingDate, createdAt) d
       FROM MeterReading
     ) mr JOIN Asset a ON a.id = mr.assetId
     WHERE mr.d < 0 GROUP BY a.code ORDER BY n DESC LIMIT 200`
  );
  checks.push({
    key: "meter-rollbacks",
    name: "Meter readings running backwards",
    description: "A cumulative odometer/hour meter that decreases points at a typo or a meter swap that needs a note.",
    count: rollbacks.reduce((s, r) => s + Number(r.n), 0),
    samples: rollbacks.slice(0, 5).map((r) => `${r.code} (${r.n})`),
  });

  // 4. Bulk tanks cannot hold negative fuel.
  const negativeTanks = await prisma.bulkTank.findMany({ where: { balance: { lt: 0 } }, select: { name: true } });
  checks.push({
    key: "negative-tanks",
    name: "Negative tank balances",
    description: "Issues drawn from a bulk tank must never exceed what the tank held.",
    count: negativeTanks.length,
    samples: negativeTanks.slice(0, 5).map((t) => t.name),
  });

  // 5. Every live fuel issue carries its price snapshot.
  const unpriced = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT COUNT(*) n FROM FuelIssue WHERE voided = 0 AND (pricePerLitre <= 0 OR (litres > 0 AND totalCost <= 0))`
  );
  checks.push({
    key: "unpriced-issues",
    name: "Fuel issues without a price snapshot",
    description: "Reports and bills cost fuel from the per-issue snapshot; a zero snapshot silently under-bills.",
    count: Number(unpriced[0]?.n ?? 0),
    samples: [],
  });

  // 6. DRAFT bills generated before a void/correction touched their period.
  const staleDrafts = await prisma.$queryRawUnsafe<{ assetCode: string; periodKey: string }[]>(
    `SELECT b.assetCode, b.periodKey FROM Bill b WHERE b.status = 'DRAFT' AND (
       EXISTS (SELECT 1 FROM FuelIssue fi WHERE fi.assetId = b.assetId AND fi.voided = 1
               AND fi.voidedAt > b.updatedAt AND fi.issueDate BETWEEN b.periodStart AND b.periodEnd)
       OR EXISTS (SELECT 1 FROM FuelIssueCorrection c WHERE c.assetId = b.assetId AND c.status = 'APPROVED'
               AND c.reviewedAt > b.updatedAt AND c.origIssueDate BETWEEN b.periodStart AND b.periodEnd)
     ) LIMIT 200`
  );
  checks.push({
    key: "stale-drafts",
    name: "Draft bills older than a correction",
    description: "A void/edit was approved after these drafts were generated — regenerate them before finalizing.",
    count: staleDrafts.length,
    samples: staleDrafts.slice(0, 5).map((r) => `${r.assetCode} ${r.periodKey}`),
  });

  // 7. Duplicate vehicle records sharing one registration identity.
  const fleet = await prisma.asset.findMany({ include: { rentalRate: { select: { id: true } } } });
  const dedupe = planMerges(
    fleet.map((a) => ({
      id: a.id,
      code: a.code,
      regNo: a.regNo,
      status: a.status,
      createdAt: a.createdAt,
      detailScore: detailScore(a),
    }))
  );
  checks.push({
    key: "duplicate-vehicles",
    name: "Duplicate vehicle records",
    description:
      "The same registration exists on more than one asset. Mergeable ones: run scripts/merge_duplicate_assets.ts; ambiguous groups need a manual decision.",
    count: dedupe.merges.length + dedupe.ambiguous.length,
    samples: [
      ...dedupe.merges.slice(0, 3).map((m) => `${m.survivor.code} ⇐ ${m.duplicates.map((d) => d.code).join(", ")}`),
      ...dedupe.ambiguous.slice(0, 2).map((g) => `${g.codes.join("/")} (manual)`),
    ],
  });

  return checks;
}
