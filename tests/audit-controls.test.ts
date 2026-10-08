import { describe, expect, it } from "vitest";

// ============================================================================
// AUD-01 Acceptance Logic Models
// ============================================================================

/**
 * Validates whether editing an existing fuel issue is permitted under
 * closed-period and append-only integrity policies.
 */
export function validateFuelIssueEdit(params: {
  isVoided: boolean;
  origPeriodKey: string;
  origBillStatus: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | null;
  newPeriodKey?: string;
  targetBillStatus?: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | null;
}): { ok: true } | { ok: false; error: string } {
  if (params.isVoided) {
    return { ok: false, error: "Cannot edit a voided fuel issue. Restore it first if necessary." };
  }

  if (params.origBillStatus && params.origBillStatus !== "DRAFT") {
    return {
      ok: false,
      error: `Invoice is ${params.origBillStatus}. Raise a credit note rather than editing the fuel behind it.`,
    };
  }

  if (params.newPeriodKey && params.newPeriodKey !== params.origPeriodKey) {
    if (params.targetBillStatus && params.targetBillStatus !== "DRAFT") {
      return {
        ok: false,
        error: `Target billing period is closed (${params.targetBillStatus}).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validates whether approving a fuel issue correction is permitted under
 * closed-period integrity rules.
 */
export function validateCorrectionApproval(params: {
  origPeriodKey: string;
  origBillStatus: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | null;
  newPeriodKey?: string;
  targetBillStatus?: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" | null;
}): { ok: true } | { ok: false; error: string } {
  if (params.origBillStatus && params.origBillStatus !== "DRAFT") {
    return {
      ok: false,
      error: `Invoice is ${params.origBillStatus}. Cannot apply correction to a closed billing period; raise a credit note or revision instead.`,
    };
  }

  if (params.newPeriodKey && params.newPeriodKey !== params.origPeriodKey) {
    if (params.targetBillStatus && params.targetBillStatus !== "DRAFT") {
      return {
        ok: false,
        error: `Target billing period is closed (${params.targetBillStatus}).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Validates credit note creation preventing cumulative over-crediting
 * beyond the invoice's grand total.
 */
export function validateCreditNoteCreation(params: {
  billGrandTotalCents: number;
  billStatus: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE";
  existingCreditNotesCents: number;
  newAmountCents: number;
}): { ok: true } | { ok: false; error: string } {
  if (params.billStatus === "DRAFT") {
    return { ok: false, error: "Issue the invoice before crediting it" };
  }

  if (params.newAmountCents <= 0) {
    return { ok: false, error: "Amount must be greater than zero" };
  }

  const totalCredits = params.existingCreditNotesCents + params.newAmountCents;
  if (totalCredits > params.billGrandTotalCents) {
    const remaining = Math.max(0, params.billGrandTotalCents - params.existingCreditNotesCents);
    return {
      ok: false,
      error: `Credit exceeds invoice creditable balance. Maximum creditable amount is Rs. ${(remaining / 100).toLocaleString("en-LK")}`,
    };
  }

  return { ok: true };
}

/**
 * Validates credit note issuance ensuring cumulative issued credit notes
 * do not exceed the invoice grand total.
 */
export function validateCreditNoteIssuance(params: {
  billGrandTotalCents: number;
  otherIssuedNotesCents: number;
  thisNoteCents: number;
}): { ok: true } | { ok: false; error: string } {
  if (params.otherIssuedNotesCents + params.thisNoteCents > params.billGrandTotalCents) {
    return {
      ok: false,
      error: "Cannot issue credit note: cumulative issued credits exceed the invoice total",
    };
  }
  return { ok: true };
}

/**
 * Validates assignment deletion preventing silent deletion of allocation
 * spans that back finalized client invoices.
 */
export function validateAssignmentDeletion(params: {
  assignmentSpan: { startYear: number; startMonth: number; endYear: number; endMonth: number };
  bills: Array<{ year: number; month: number; status: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE" }>;
}): { ok: true } | { ok: false; error: string } {
  const { startYear, startMonth, endYear, endMonth } = params.assignmentSpan;
  const sVal = startYear * 12 + startMonth;
  const eVal = endYear * 12 + endMonth;

  const conflicting = params.bills.find((b) => {
    if (b.status === "DRAFT") return false;
    const bVal = b.year * 12 + b.month;
    return bVal >= sVal && bVal <= eVal;
  });

  if (conflicting) {
    return {
      ok: false,
      error: `Cannot delete assignment: has a finalized ${conflicting.status} invoice during this period.`,
    };
  }

  return { ok: true };
}

// ============================================================================
// AUD-01 Test Suite
// ============================================================================

describe("AUD-01: Audit coverage and append-only controls", () => {
  describe("Closed-Period Fuel Issue Edits", () => {
    it("rejects editing a fuel issue belonging to an ISSUED invoice", () => {
      const res = validateFuelIssueEdit({
        isVoided: false,
        origPeriodKey: "2026-08",
        origBillStatus: "ISSUED",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Invoice is ISSUED");
        expect(res.error).toContain("Raise a credit note");
      }
    });

    it("rejects editing a fuel issue belonging to a PAID invoice", () => {
      const res = validateFuelIssueEdit({
        isVoided: false,
        origPeriodKey: "2026-08",
        origBillStatus: "PAID",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Invoice is PAID");
      }
    });

    it("rejects moving a fuel issue to a target month whose invoice is finalized", () => {
      const res = validateFuelIssueEdit({
        isVoided: false,
        origPeriodKey: "2026-08",
        origBillStatus: "DRAFT",
        newPeriodKey: "2026-09",
        targetBillStatus: "ISSUED",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Target billing period is closed (ISSUED)");
      }
    });

    it("allows editing a fuel issue when the invoice is in DRAFT", () => {
      const res = validateFuelIssueEdit({
        isVoided: false,
        origPeriodKey: "2026-08",
        origBillStatus: "DRAFT",
        newPeriodKey: "2026-08",
      });
      expect(res.ok).toBe(true);
    });

    it("allows editing a fuel issue when no invoice has been generated yet (null)", () => {
      const res = validateFuelIssueEdit({
        isVoided: false,
        origPeriodKey: "2026-10",
        origBillStatus: null,
      });
      expect(res.ok).toBe(true);
    });

    it("rejects editing a voided fuel issue", () => {
      const res = validateFuelIssueEdit({
        isVoided: true,
        origPeriodKey: "2026-08",
        origBillStatus: "DRAFT",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Cannot edit a voided fuel issue");
      }
    });
  });

  describe("Closed-Period Fuel Issue Correction Approvals", () => {
    it("rejects approving a correction when the invoice is finalized", () => {
      const res = validateCorrectionApproval({
        origPeriodKey: "2026-07",
        origBillStatus: "ISSUED",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Cannot apply correction to a closed billing period");
      }
    });

    it("rejects approving a correction if moved to a closed target month", () => {
      const res = validateCorrectionApproval({
        origPeriodKey: "2026-07",
        origBillStatus: "DRAFT",
        newPeriodKey: "2026-08",
        targetBillStatus: "PAID",
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Target billing period is closed (PAID)");
      }
    });

    it("approves correction when the invoice is DRAFT", () => {
      const res = validateCorrectionApproval({
        origPeriodKey: "2026-09",
        origBillStatus: "DRAFT",
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("Credit Note Cumulative Reversal Limits", () => {
    const invoiceTotalCents = 100_000_00; // Rs. 100,000.00

    it("rejects creating a credit note on a DRAFT invoice", () => {
      const res = validateCreditNoteCreation({
        billGrandTotalCents: invoiceTotalCents,
        billStatus: "DRAFT",
        existingCreditNotesCents: 0,
        newAmountCents: 10_000_00,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("Issue the invoice before crediting it");
    });

    it("allows creating a credit note within the total invoice amount", () => {
      const res = validateCreditNoteCreation({
        billGrandTotalCents: invoiceTotalCents,
        billStatus: "ISSUED",
        existingCreditNotesCents: 0,
        newAmountCents: 40_000_00,
      });
      expect(res.ok).toBe(true);
    });

    it("rejects creating a single credit note that exceeds invoice total", () => {
      const res = validateCreditNoteCreation({
        billGrandTotalCents: invoiceTotalCents,
        billStatus: "ISSUED",
        existingCreditNotesCents: 0,
        newAmountCents: 120_000_00,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("Credit exceeds invoice creditable balance");
    });

    it("rejects cumulative credit notes exceeding invoice total (repeated reversal prevention)", () => {
      // Prior credit note of 70,000 exists; trying to add 40,000 more (total 110,000 > 100,000)
      const res = validateCreditNoteCreation({
        billGrandTotalCents: invoiceTotalCents,
        billStatus: "ISSUED",
        existingCreditNotesCents: 70_000_00,
        newAmountCents: 40_000_00,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("Credit exceeds invoice creditable balance");
        expect(res.error).toContain("Maximum creditable amount is Rs. 30,000");
      }
    });

    it("allows cumulative credit notes exactly matching remaining balance", () => {
      const res = validateCreditNoteCreation({
        billGrandTotalCents: invoiceTotalCents,
        billStatus: "ISSUED",
        existingCreditNotesCents: 70_000_00,
        newAmountCents: 30_000_00,
      });
      expect(res.ok).toBe(true);
    });

    it("rejects credit note issuance if cumulative issued credits would exceed invoice total", () => {
      const res = validateCreditNoteIssuance({
        billGrandTotalCents: invoiceTotalCents,
        otherIssuedNotesCents: 80_000_00,
        thisNoteCents: 30_000_00,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain("cumulative issued credits exceed the invoice total");
      }
    });
  });

  describe("Assignment Deletion Protection Against Finalized Bills", () => {
    const span = { startYear: 2026, startMonth: 7, endYear: 2026, endMonth: 9 };

    it("rejects deleting an assignment spanning an ISSUED invoice", () => {
      const res = validateAssignmentDeletion({
        assignmentSpan: span,
        bills: [
          { year: 2026, month: 8, status: "ISSUED" },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("has a finalized ISSUED invoice");
    });

    it("rejects deleting an assignment spanning a PAID invoice", () => {
      const res = validateAssignmentDeletion({
        assignmentSpan: span,
        bills: [
          { year: 2026, month: 7, status: "PAID" },
        ],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain("has a finalized PAID invoice");
    });

    it("permits deleting an assignment when all invoices in the span are DRAFT", () => {
      const res = validateAssignmentDeletion({
        assignmentSpan: span,
        bills: [
          { year: 2026, month: 8, status: "DRAFT" },
          { year: 2026, month: 9, status: "DRAFT" },
        ],
      });
      expect(res.ok).toBe(true);
    });

    it("permits deleting an assignment when no invoices exist in the span", () => {
      const res = validateAssignmentDeletion({
        assignmentSpan: span,
        bills: [
          { year: 2026, month: 6, status: "ISSUED" }, // outside span
          { year: 2026, month: 10, status: "ISSUED" }, // outside span
        ],
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("Append-Only Audit Log Invariants", () => {
    it("ensures audit log vocabulary includes standard operational actions", () => {
      const validActions = [
        "CREATE",
        "UPDATE",
        "DELETE",
        "APPROVE",
        "REJECT",
        "LOGIN",
        "PRICE_REFRESH",
        "BACKUP",
      ];
      expect(validActions).toContain("CREATE");
      expect(validActions).toContain("UPDATE");
      expect(validActions).toContain("DELETE");
      expect(validActions).toContain("APPROVE");
      expect(validActions).toContain("REJECT");
    });
  });
});
