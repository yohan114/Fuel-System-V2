import { describe, expect, it } from "vitest";
import { formatInvoiceNumber } from "../src/lib/billing/invoice-number";

describe("formatInvoiceNumber", () => {
  it("zero-pads the sequence to four digits", () => {
    expect(formatInvoiceNumber("EC-INV", 2026, 1)).toBe("EC-INV-2026-0001");
    expect(formatInvoiceNumber("EC-INV", 2026, 42)).toBe("EC-INV-2026-0042");
  });
  it("does not truncate sequences beyond four digits", () => {
    expect(formatInvoiceNumber("EC-INV", 2026, 12345)).toBe("EC-INV-2026-12345");
  });
  it("carries the calendar year, not the month", () => {
    // Same prefix + year in different months yields a continuous run, so the
    // month never appears and Jan does not collide with Feb.
    expect(formatInvoiceNumber("EC-INV", 2026, 100)).toBe("EC-INV-2026-0100");
    expect(formatInvoiceNumber("EC-INV", 2027, 1)).toBe("EC-INV-2027-0001");
  });
  it("honours a custom prefix", () => {
    expect(formatInvoiceNumber("INV", 2025, 7)).toBe("INV-2025-0007");
  });
});
