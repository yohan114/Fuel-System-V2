import { describe, expect, it } from "vitest";
import {
  buildSiteStatements,
  totalStatement,
  type StatementBill,
  type StatementCredit,
  type StatementPayment,
} from "../src/lib/billing/statement";

function bill(over: Partial<StatementBill> & { billId: string }): StatementBill {
  return {
    projectId: "site-A",
    projectName: "Site A",
    projectCode: "A",
    assetCode: "DT-1",
    invoiceNumber: "EC-INV-2026-0001",
    status: "ISSUED",
    grandTotalCents: 100_000,
    ...over,
  };
}

describe("buildSiteStatements", () => {
  it("reconciles outstanding = invoiced − credited − paid", () => {
    const bills = [bill({ billId: "b1", grandTotalCents: 100_000 }), bill({ billId: "b2", grandTotalCents: 50_000 })];
    const credits: StatementCredit[] = [{ billId: "b1", number: "CN-1", reason: "adj", amountCents: 20_000, status: "ISSUED" }];
    const payments: StatementPayment[] = [{ billId: "b2", amountCents: 30_000, paidDate: new Date(), method: "Cash", reference: null }];
    const [s] = buildSiteStatements(bills, credits, payments);
    expect(s.invoicedCents).toBe(150_000);
    expect(s.creditedCents).toBe(20_000);
    expect(s.paidCents).toBe(30_000);
    expect(s.outstandingCents).toBe(100_000); // 150k − 20k − 30k
  });

  it("excludes DRAFT invoices from the charged total but a real invoice still counts", () => {
    const bills = [bill({ billId: "b1", status: "DRAFT", grandTotalCents: 999_999 }), bill({ billId: "b2", status: "ISSUED", grandTotalCents: 40_000 })];
    const [s] = buildSiteStatements(bills, [], []);
    expect(s.invoices).toHaveLength(1);
    expect(s.invoicedCents).toBe(40_000);
  });

  it("lists a DRAFT credit note but does not net it against the balance", () => {
    const bills = [bill({ billId: "b1", grandTotalCents: 100_000 })];
    const credits: StatementCredit[] = [
      { billId: "b1", number: null, reason: "pending", amountCents: 25_000, status: "DRAFT" },
      { billId: "b1", number: "CN-9", reason: "approved", amountCents: 10_000, status: "ISSUED" },
    ];
    const [s] = buildSiteStatements(bills, credits, []);
    expect(s.creditNotes).toHaveLength(2);
    expect(s.creditedCents).toBe(10_000); // only the ISSUED one
    expect(s.outstandingCents).toBe(90_000);
  });

  it("buckets credits and payments to the right site via billId", () => {
    const bills = [
      bill({ billId: "a1", projectId: "site-A", projectName: "Site A", projectCode: "A", grandTotalCents: 100_000 }),
      bill({ billId: "z1", projectId: "site-Z", projectName: "Site Z", projectCode: "Z", grandTotalCents: 100_000 }),
    ];
    const credits: StatementCredit[] = [{ billId: "z1", number: "CN", reason: "r", amountCents: 15_000, status: "ISSUED" }];
    const payments: StatementPayment[] = [{ billId: "a1", amountCents: 40_000, paidDate: new Date(), method: null, reference: null }];
    const statements = buildSiteStatements(bills, credits, payments);
    const A = statements.find((s) => s.projectCode === "A")!;
    const Z = statements.find((s) => s.projectCode === "Z")!;
    expect(A.paidCents).toBe(40_000);
    expect(A.creditedCents).toBe(0);
    expect(A.outstandingCents).toBe(60_000);
    expect(Z.creditedCents).toBe(15_000);
    expect(Z.paidCents).toBe(0);
    expect(Z.outstandingCents).toBe(85_000);
  });

  it("drops a site that only had draft bills", () => {
    const bills = [bill({ billId: "b1", status: "DRAFT" })];
    expect(buildSiteStatements(bills, [], [])).toEqual([]);
  });

  it("ignores credits/payments whose bill is out of scope", () => {
    const bills = [bill({ billId: "b1" })];
    const credits: StatementCredit[] = [{ billId: "other", number: "X", reason: "r", amountCents: 5_000, status: "ISSUED" }];
    const payments: StatementPayment[] = [{ billId: "other", amountCents: 5_000, paidDate: new Date(), method: null, reference: null }];
    const [s] = buildSiteStatements(bills, credits, payments);
    expect(s.creditedCents).toBe(0);
    expect(s.paidCents).toBe(0);
    expect(s.outstandingCents).toBe(100_000);
  });
});

describe("totalStatement", () => {
  it("rolls up all sites", () => {
    const bills = [
      bill({ billId: "a1", projectId: "A", projectName: "A", projectCode: "A", grandTotalCents: 100_000 }),
      bill({ billId: "b1", projectId: "B", projectName: "B", projectCode: "B", grandTotalCents: 200_000 }),
    ];
    const payments: StatementPayment[] = [{ billId: "a1", amountCents: 50_000, paidDate: new Date(), method: null, reference: null }];
    const t = totalStatement(buildSiteStatements(bills, [], payments));
    expect(t.invoicedCents).toBe(300_000);
    expect(t.paidCents).toBe(50_000);
    expect(t.outstandingCents).toBe(250_000);
  });
});
