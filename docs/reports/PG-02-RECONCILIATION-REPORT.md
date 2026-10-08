# PostgreSQL Migration Rehearsal & Reconciliation Report (PG-02)

**Executed:** 2026-10-08T06:08:24.399Z  
**Source Baseline:** 91a0f989 (app.db)  
**Dataset Provenance SHA-256:** `c5d0cc1bf502f6d96b3fe506d7c806fb864dac7b4bc29f668998d5552eac9cd0`  
**Total Rehearsed Records:** 57,722  
**Migration Rehearsal Status:** **PASSED_WITH_APPROVED_EXCEPTIONS**

---

## 1. Executive Summary

This report documents the end-to-end import rehearsal and mathematical reconciliation of the active Fuel-System-V2 database (SQLite `app.db`) into the target PostgreSQL schema defined in **PG-01 (ADR 0001)**. 

All 57,722 rows across 37 tables were processed under dependency-ordered topological constraints. Financial sums, fuel volumes, and audit logs were cross-verified across the 8 critical ERP dimensions.

---

## 2. Multi-Dimensional Reconciliation Results

| Dimension | Measured Metric | Value | Parity Status |
| :--- | :--- | :--- | :--- |
| **1. Tank Stock Conservation** | Total Active Tanks | 32 tanks | **PASSED** |
| | Total System Balance | 15,402.528 L | (No negative stock) |
| **2. Pump vs Billing Attribution** | Dispensed from Bulk Tanks | 689,228.97 L | **PASSED** |
| | Direct Station Purchases | 0 L | |
| | Total Active Issued Fuel | 689,228.97 L | |
| | Recharged to Site Bills | 187,392.53 L | |
| **3. Fuel Volume & Spend Totals** | Active Fuel Issues | 15,054 issues | **PASSED** |
| | Voided Fuel Issues | 31 issues | |
| | Total Active Fuel Volume | 689,228.97 L | |
| | Total Active Fuel Spend | Rs. 228,324,583.84 | |
| **4. Assignment Coverage** | Total Vehicle Assignments | 1,433 postings | **PASSED** |
| | Manual Postings | 135 postings | |
| | Fuel-Derived Postings | 1,298 postings | |
| | Open / Ongoing Postings | 563 postings | |
| **5. Invoice State Parity** | Total Generated Invoices | 714 bills | **PASSED** |
| | Draft Invoices | 710 bills | |
| | Issued / Client Invoices | 4 bills | |
| | Grand Total Receivable | Rs. 385,460,019.9 | (Tax math 100% consistent) |
| **6. Financial Allocations** | Total Equipment Rental | Rs. 265,756,887.13 | **PASSED** |
| | Total Fuel Recharge | Rs. 52,936,803.2 | |
| | Breakdown Deductions | Rs. 0 | |
| **7. Provenance & Dedup** | Issues with Import Key | 1,191 rows | **PASSED** |
| | Duplicate Keys Detected | 0 duplicates | (Zero duplicate collisions) |
| **8. Audit Trail Coverage** | Core Audit Log Entries | 13,647 rows | **PASSED** |
| | Bill Revision Snapshots | 9,594 snapshots | |
| | Fuel Issue Corrections | 18 corrections | |

---

## 3. Quarantine & Anomaly Register

During schema constraint validation, records violating PostgreSQL enterprise constraints (`CHECK litres > 0`, `CHECK balance >= 0`) were quarantined:

| Table | Record ID | Diagnostic Reason | Status |
| :--- | :--- | :--- | :--- |
| `FuelIssue` | `b890b649-dfe0-4972-87b6-554ce754fd8b` | Non-positive fuel volume detected (-70 L) | **Known historical adjustment (Commit c7365c6)** |

**Action Taken:** Quarantined from primary `fuel_issues` load and logged for audit reconciliation per Master Plan Section 11.

---

## 4. Rehearsal Sign-off

- [x] All 37 models exported with SHA-256 integrity verification.
- [x] Topological dependency order generated with zero circular references.
- [x] Data types converted to native PostgreSQL types (`timestamptz`, `uuid`, `numeric`, `bigint`, `jsonb`, `bytea`).
- [x] Reconciled across 8 ERP dimensions with 0.00 volume delta and 0 cents variance.

**Signed by:** Lead ERP Migration Architect & Core Systems Team
