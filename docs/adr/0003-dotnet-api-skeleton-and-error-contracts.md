# ADR 0003: .NET API Skeleton, OpenAPI 3.1 & RFC 7807 Error Contracts (API-01)

- **Status**: Accepted
- **Date**: 2026-10-08
- **Context**: Wave D (Backend Replacement) of Enterprise ERP Implementation Master Plan
- **Authors**: Core Engineering & Architecture Team
- **Dependencies**: DOM-01, PG-01, PG-02, RLS-01, Master Plan Section 4 & 16

---

## 1. Context and Problem Statement

The Fuel-System-V2 platform is transitioning from a Next.js full-stack monolith to a dual-tier enterprise ERP architecture:
1. **Frontend Tier**: Preserve the existing Next.js + React UI for desktop office operations, mobile fuel attendants, and report exports.
2. **Backend Composition Root**: Implement a high-performance modular monolith on **ASP.NET Core (.NET 10 LTS)** with PostgreSQL as the single authoritative writer.
3. **Seam Transition & Migration Safety**: Before shifting write authority in `API-02`, the API contracts, error response specifications, and skeleton layout must be fully defined, validated, and backward-compatible.

Prior to this decision:
- Next.js API routes used custom error payloads (`{ ok: false, error: { code, message } }`).
- Client applications had no standard machine-readable error format for domain conflicts (e.g. `INSUFFICIENT_STOCK`, `METER_OUTAGE_ACTIVE`, `CLOSED_PERIOD_LOCKED`).
- There was no .NET composition root or vertical module layout matching `DOM-01` typed command definitions.

---

## 2. Decision Drivers

- **Standardized Error Semantics**: Adopt IETF **RFC 7807 (`application/problem+json`)** as the universal error contract for both the ASP.NET Core backend and Next.js route handlers.
- **Strict Typing and Command Equivalence**: API endpoints must map 1:1 with the typed application commands established in `DOM-01` (`IssueFuel`, `VoidFuelIssue`, `ApproveTransfer`, `IssueInvoice`).
- **OpenAPI 3.1 Source of Truth**: Expose comprehensive OpenAPI 3.1 specifications documenting request bodies, status codes, idempotency headers, and problem details.
- **Replay Safety (Idempotency)**: Enforce `X-Idempotency-Key` headers on all state-mutating command endpoints (`TX-02`).
- **Zero Frontend Disruption**: Allow existing Next.js clients to consume responses without breaking legacy format expectations.

---

## 3. Architecture Specification

### 3.1 Modular Monolith Layout

```text
apps/
  api/                                # ASP.NET Core Composition Root (.NET 10 LTS)
    FuelSystem.Api.csproj             # Web SDK project file with Npgsql, OpenAPI, Scalar
    Program.cs                        # Minimal API composition, ProblemDetails, CORS, Health
    appsettings.json                  # PostgreSQL connection string & security config
src/
  Modules/                            # Vertical Slice Domain Modules
    Common/                           # ProblemDetails extensions, Result patterns
    Fuel/                             # FuelEndpoints.cs, IssueFuel, VoidFuelIssue
    Allocation/                       # Vehicle allocations, transfer approval
    Billing/                          # BillingEndpoints.cs, IssueInvoice
```

### 3.2 RFC 7807 Problem Details Standard

All 4xx and 5xx error responses conform to the following JSON structure:

```json
{
  "type": "https://fuelsystem.erp/errors/INSUFFICIENT_STOCK",
  "title": "Insufficient Bulk Tank Stock",
  "status": 422,
  "detail": "Tank balance is insufficient for requested fuel dispatch volume.",
  "instance": "/api/v1/fuel/issues",
  "code": "INSUFFICIENT_STOCK",
  "errors": {
    "litres": ["Requested 50.0L exceeds remaining balance of 40.0L"]
  }
}
```

### 3.3 Core Command Endpoints (Mapped from DOM-01)

| HTTP Method | Route | Command Handled | Success | Problem Codes |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/fuel/issues` | `IssueFuelCommand` | `201 Created` | `VALIDATION_ERROR`, `INSUFFICIENT_STOCK`, `INVALID_QUANTITY`, `IDEMPOTENCY_CONFLICT` |
| `POST` | `/api/v1/fuel/issues/{id}/void` | `VoidFuelIssueCommand` | `200 OK` | `ISSUE_NOT_FOUND`, `ALREADY_VOIDED`, `CLOSED_PERIOD_LOCKED` |
| `POST` | `/api/v1/tanks/{id}/transfers/approve` | `ApproveTransferCommand` | `200 OK` | `FORBIDDEN_RESOURCE`, `INSUFFICIENT_SOURCE_STOCK` |
| `POST` | `/api/v1/bills/{id}/issue` | `IssueInvoiceCommand` | `200 OK` | `FORBIDDEN_RESOURCE`, `BILL_NOT_FOUND`, `ALREADY_ISSUED` |

---

## 4. Consequences

### Positive
- **Single Standard**: Consistent RFC 7807 error schema across frontend UI alerts, mobile attendant apps, and backend services.
- **Enterprise Readiness**: .NET 10 LTS composition root provides long-term support through November 2028 with native AOT and high-throughput Npgsql pooling.
- **Automated Client Generation**: OpenAPI 3.1 specification enables typed TypeScript and C# client generation via openapi-typescript or Kiota.

### Negative / Trade-offs
- Client error parsers must check both legacy `{ ok: false, error: ... }` and RFC 7807 `application/problem+json` during the transitional migration window.
