# Golden-Case Billing Parity & Invoice Protection Report (BILL-01)

**Executed:** 2026-10-08T09:03:51.914Z  
**Master Plan Task:** BILL-01 (Wave D — Backend Replacement)  
**Total Invoices Audited:** 714  
**Historical Issued Invoices:** 4  
**Total Revision Snapshots:** 9594  
**Statutory Tax Parity Status:** **PASSED (100% PARITY)**

---

## 1. Executive Summary

This report delivers the verification evidence for **BILL-01** as mandated by the Fuel-System-V2 Enterprise ERP Implementation Master Plan.

The billing engine preserves historical and statutory integrity through:
1. **Zero Dual-Master Drift**: Issued invoices remain completely immutable against rate card revisions, fuel price adjustments, or draft regeneration runs.
2. **Statutory Sri Lankan Tax Precision**: Social Security Contribution Levy (**SSCL 2.5%**) on subtotal, followed by Value Added Tax (**VAT 18.0%**) on *(Subtotal + SSCL)* with integer-cent rounding.
3. **Multi-Archetype Golden Cases**: All machine classes (Dry day-hire, Wet day-hire, heavy plant, multi-site split assignments, hourly metered equipment, and fuel-only vehicles) produce exact bit-for-bit math parity.
4. **Historical Snapshot Auditing**: 100% of the 9594 revision snapshots parse cleanly with valid financial audit structures.

---

## 2. Invoiced Portfolio Reconciled Totals

| Portfolio Dimension | Quantity | Measured Amount (LKR) | Statutory Consistency |
| :--- | :--- | :--- | :--- |
| **Total Invoices in Database** | 714 bills | Rs. 385,460,019.90 | **100.0%** |
| • Draft Bills | 710 bills | Rs. 384,456,962.04 | Validated against pure math engine |
| • Client Issued Invoices | 4 invoices | Rs. 1,003,057.86 | **Zero mutation permitted** |
| **Statutory Subtotal (Rental + Fuel)** | — | Rs. 318,693,690.33 | Integral cents verified |
| **Social Security Contribution Levy (2.5%)** | — | Rs. 7,967,342.84 | `round(subtotal * 0.025)` |
| **Value Added Tax (18.0%)** | — | Rs. 58,798,986.73 | `round((subtotal + SSCL) * 0.18)` |
| **Statutory Tax Anomalies** | **0** | **Rs. 0.00** | **Zero drift across 714 bills** |

---

## 3. Historical Issued Invoices Verification

All 4 client-facing issued invoices in the database were examined and verified against statutory rate cards and lines:

| Invoice Number | Asset Code | Period | Mode / Basis | Billable Units | Subtotal (LKR) | SSCL (LKR) | VAT (LKR) | Grand Total (LKR) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `EC-INV-2026-0001` | **AC-25** | 2026-07 | perday / D | 26.00 | Rs. 286,000.00 | Rs. 7,150.00 | Rs. 52,767.00 | Rs. 345,917.00 | **ISSUED** |
| `EC-INV-2026-0002` | **WATER PUMP** | 2026-07 | perday / W | 26.00 | Rs. 98,800.00 | Rs. 2,470.00 | Rs. 18,228.60 | Rs. 119,498.60 | **ISSUED** |
| `EC-INV-2026-0004` | **AC-24** | 2026-07 | perday / D | 16.77 | Rs. 184,516.13 | Rs. 4,612.90 | Rs. 34,043.23 | Rs. 223,172.26 | **ISSUED** |
| `EC-INV-2026-0003` | **GE-62** | 2026-07 | perday / D | 26.00 | Rs. 260,000.00 | Rs. 6,500.00 | Rs. 47,970.00 | Rs. 314,470.00 | **ISSUED** |

### Invoice Preservation Rules:
- **Rule 1 (Regeneration Barrier)**: Calling `generateBillForAsset()` on any of these assets returns `{ status: "skipped-finalized" }` without mutating the invoice row or deleting line items.
- **Rule 2 (Rate Card Isolation)**: Changing `RentalRate` or fuel unit prices in the catalog leaves issued invoice rows untouched.
- **Rule 3 (Credit Note Amendment)**: In accordance with Master Plan Section 5, any post-issuance commercial correction must be posted as a `CreditNote`, never through deletion or silent recalculation.

---

## 4. Multi-Archetype Golden Cases

### Archetype 1: Day-based Dry Hire with Multi-site History (Air Compressor)
- **Identifier**: `ARCHETYPE-1-DAY-DRY` (`AC-25`)
- **Period**: `2026-07` | **Status**: `ISSUED` | **Invoice**: `EC-INV-2026-0001`
- **Terms**: Billing Mode: `perday`, Basis: `D`, Unit Rate: Rs. 11,000.00
- **Usage**: Actual Units: `0`, Minimum Floor: `26`, Billable Units: `26.00`
- **Financial Breakdown**:
  - Rental Amount: Rs. 286,000.00
  - Fuel Volume & Charge: `90 L` (Rs. 0.00)
  - Subtotal: Rs. 286,000.00
  - SSCL (2.5%): Rs. 7,150.00
  - VAT (18.0%): Rs. 52,767.00
  - **Grand Total**: **Rs. 345,917.00**
- **Parity Status**: **PASSED (Bit-for-bit exact)**

### Archetype 2: Day-based Wet Hire (Self-Supplied Operator/Plant)
- **Identifier**: `ARCHETYPE-2-DAY-WET` (`WATER PUMP`)
- **Period**: `2026-07` | **Status**: `ISSUED` | **Invoice**: `EC-INV-2026-0002`
- **Terms**: Billing Mode: `perday`, Basis: `W`, Unit Rate: Rs. 3,800.00
- **Usage**: Actual Units: `0`, Minimum Floor: `26`, Billable Units: `26.00`
- **Financial Breakdown**:
  - Rental Amount: Rs. 98,800.00
  - Fuel Volume & Charge: `0 L` (Rs. 0.00)
  - Subtotal: Rs. 98,800.00
  - SSCL (2.5%): Rs. 2,470.00
  - VAT (18.0%): Rs. 18,228.60
  - **Grand Total**: **Rs. 119,498.60**
- **Parity Status**: **PASSED (Bit-for-bit exact)**

### Archetype 3: High-Capacity Generator (Fixed Plant with Client Fuel)
- **Identifier**: `ARCHETYPE-3-HIGH-CAPACITY-GEN` (`GE-62`)
- **Period**: `2026-07` | **Status**: `ISSUED` | **Invoice**: `EC-INV-2026-0003`
- **Terms**: Billing Mode: `perday`, Basis: `D`, Unit Rate: Rs. 10,000.00
- **Usage**: Actual Units: `0`, Minimum Floor: `26`, Billable Units: `26.00`
- **Financial Breakdown**:
  - Rental Amount: Rs. 260,000.00
  - Fuel Volume & Charge: `190 L` (Rs. 0.00)
  - Subtotal: Rs. 260,000.00
  - SSCL (2.5%): Rs. 6,500.00
  - VAT (18.0%): Rs. 47,970.00
  - **Grand Total**: **Rs. 314,470.00**
- **Parity Status**: **PASSED (Bit-for-bit exact)**

### Archetype 4: Multi-Site Split Assignment with Fractional Working Days
- **Identifier**: `ARCHETYPE-4-SPLIT-MONTH-MACHINE` (`AC-24`)
- **Period**: `2026-07` | **Status**: `ISSUED` | **Invoice**: `EC-INV-2026-0004`
- **Terms**: Billing Mode: `perday`, Basis: `D`, Unit Rate: Rs. 11,000.00
- **Usage**: Actual Units: `0`, Minimum Floor: `26`, Billable Units: `16.77`
- **Financial Breakdown**:
  - Rental Amount: Rs. 184,516.13
  - Fuel Volume & Charge: `50 L` (Rs. 0.00)
  - Subtotal: Rs. 184,516.13
  - SSCL (2.5%): Rs. 4,612.90
  - VAT (18.0%): Rs. 34,043.23
  - **Grand Total**: **Rs. 223,172.26**
- **Parity Status**: **PASSED (Bit-for-bit exact)**

### Archetype 5: Hourly Earthmover with Metered Consumption & Minimum Guarantee Floor
- **Identifier**: `ARCHETYPE-5-HOURLY-EARTHMOVER` (`CR-01`)
- **Period**: `2026-07` | **Status**: `DRAFT`
- **Terms**: Billing Mode: `hourly`, Basis: `W`, Unit Rate: Rs. 5,100.00
- **Usage**: Actual Units: `24.545454545454543`, Minimum Floor: `120`, Billable Units: `120.00`
- **Financial Breakdown**:
  - Rental Amount: Rs. 612,000.00
  - Fuel Volume & Charge: `270 L` (Rs. 105,490.00)
  - Subtotal: Rs. 717,490.00
  - SSCL (2.5%): Rs. 17,937.25
  - VAT (18.0%): Rs. 132,376.91
  - **Grand Total**: **Rs. 867,804.16**
- **Parity Status**: **PASSED (Bit-for-bit exact)**

### Archetype 6: Fuel-Only Vehicle (Zero Rental, Billed Fuel + Statutory Levies)
- **Identifier**: `ARCHETYPE-6-FUEL-ONLY` (`GE-117`)
- **Period**: `2026-05` | **Status**: `DRAFT`
- **Terms**: Billing Mode: `hourly`, Basis: `W`, Unit Rate: Rs. 0.00
- **Usage**: Actual Units: `0`, Minimum Floor: `120`, Billable Units: `120.00`
- **Financial Breakdown**:
  - Rental Amount: Rs. 0.00
  - Fuel Volume & Charge: `5368 L` (Rs. 1,535,248.00)
  - Subtotal: Rs. 1,535,248.00
  - SSCL (2.5%): Rs. 38,381.20
  - VAT (18.0%): Rs. 283,253.26
  - **Grand Total**: **Rs. 1,856,882.46**
- **Parity Status**: **PASSED (Bit-for-bit exact)**


---

## 5. Audit Trail & Revision Snapshot Protection

- **Total Historical Snapshots Audited**: 9594
- **Valid JSON Snapshots**: 9594 (100.0%)
- **Corrupt / Unparseable Snapshots**: 0 (0.0%)
- **Revision Snapshot Semantics**:
  Whenever a DRAFT bill is regenerated, `snapshotPriorRevision()` inside the transaction serializes a `BillSnapshot` into `BillRevision` before applying the recalculation. Every historical iteration is preserved and diffable via `summarizeRevisionDiff()`.

---

## 6. Acceptance Sign-Off

- [x] All 714 database invoices evaluated with 0 tax calculation deviations.
- [x] All 4 historical issued invoices verified as immutable.
- [x] All 6 equipment archetypes demonstrate 100% mathematical parity against pure calculation engine.
- [x] Zero dual-master split-brain or destructive draft regeneration on finalized invoices.

**Signed by:** Lead ERP Migration Architect & Core Systems Team
