# ADR 0004: Fuel Single-Writer Gateway & Transactional Outbox Pattern (API-02)

- **Status**: Accepted
- **Date**: 2026-10-08
- **Context**: Wave D (Backend Replacement) of Enterprise ERP Implementation Master Plan
- **Authors**: Core Engineering & Architecture Team
- **Dependencies**: PG-02, API-01, TX-02, DOM-01, Master Plan Section 8 & 10

---

## 1. Context and Problem Statement

As Fuel-System-V2 transitions from SQLite to an enterprise PostgreSQL backend powered by ASP.NET Core (.NET 10 LTS), maintaining **data consistency and preventing split-brain writes** is critical.

Master Plan Section 10 requires:
> *"Exit: one writer per domain; old handlers delegate or are disabled."*

And Section 16 mandates:
> *"Keep one authoritative writer per migrated domain. Preserve identifiers or explicit mappings. Verify tenant/resource authorization on every action, API, export, import, job, and integration path."*

If both the Next.js server actions and the .NET composition root were to independently mutate fuel stock and billing state simultaneously, the database would suffer from:
1. Concurrency anomalies and race conditions on physical tank balances.
2. Divergent audit log trails and uncoordinated sequence numbers.
3. Inconsistent downstream side effects (e.g., duplicated maintenance work orders or alerts).

---

## 2. Decision Drivers

- **Zero Dual-Master Split-Brain**: Guarantee that for any given deployment phase, exactly one system serves as the authoritative writer for fuel transactions (`IssueFuel` and `VoidFuelIssue`).
- **Transactional Outbox Event Stream**: Every state mutation must atomically emit an outbox record (`FuelIssued`, `FuelVoided`) inside the database transaction (Section 8, Step 9), decoupling asynchronous background processing from the synchronous critical write path.
- **Replay Safety & Conflict Rejection**: Idempotency keys (`X-Idempotency-Key`) must be checked atomically; duplicate requests return the original result, while mismatched payloads return `409 Conflict`.
- **Zero UI Disruption**: The Next.js frontend (desktop office, attendant mobile PWA, Server Actions, and REST routes) remains unchanged by delegating through the authoritative write gateway.
- **Instant Cutover & Rollback**: Switching write authority between local execution and the remote .NET API is controlled dynamically via `FUEL_WRITE_AUTHORITY`.

---

## 3. Architecture Specification

### 3.1 The Authoritative Single-Writer Gateway

The gateway (`src/lib/fuel/write-gateway.ts`) intercepts all fuel mutation requests:

```text
[Next.js Server Actions] \
[Attendant Mobile Forms]  --> [Authoritative Write Gateway]
[REST /api/v1 Routes   ] /           │
                                     ├── [Mode: LOCAL_COMMAND] ──> executeIssueFuel() ──> Local Atomic Transaction
                                     │                                                      ├── Stock Deduction
                                     │                                                      ├── Issue Creation
                                     │                                                      ├── Audit Log
                                     │                                                      └── Outbox Event
                                     │
                                     └── [Mode: REMOTE_API]    ──> HTTP Forward ──> ASP.NET Core Composition Root
                                                                   (X-Idempotency-Key)  (/api/v1/fuel/issues)
                                                                                        (RFC 7807 Problem Translation)
```

### 3.2 Gateway Dispatch Modes

1. **`LOCAL_COMMAND` (Initial Transitional Authority)**:
   - Evaluates commands against `executeIssueFuel` and `executeVoidFuelIssue` in `src/lib/commands/`.
   - Enforces atomic stock deduction (`deductTankStockAtomically`), daily vehicle caps, price version resolution, audit logs, and outbox event publishing.
2. **`REMOTE_API` (Target Production Authority)**:
   - Forwards the request payload to the ASP.NET Core composition root (`apps/api/`) over HTTP.
   - Forwards `X-Idempotency-Key`, `X-Actor-Id`, and tenant claims.
   - Translates RFC 7807 Problem Details (`application/problem+json`) directly into structured `CommandResult` failure outcomes.

### 3.3 Transactional Outbox Pattern

Every successful fuel transaction atomically inserts a domain outbox message into `outbox_messages`:

```json
{
  "eventType": "FuelIssued",
  "aggregateType": "FuelIssue",
  "aggregateId": "f784e12c-901b-432d-9860-1e52bcde3810",
  "payload": {
    "issueId": "f784e12c-901b-432d-9860-1e52bcde3810",
    "assetCode": "CAB-1001",
    "litres": 45.0,
    "fuelKind": "AUTO_DIESEL",
    "totalCost": 1719000,
    "unitPrice": 38200,
    "bulkTankId": "cc7612c1-b235-4670-8284-45657874fec6",
    "issuedById": "d3a40965-d1a9-4fc0-b047-66adaeb4c9dc",
    "issueDate": "2026-10-08T08:30:00.000Z"
  }
}
```

This guarantees that downstream tasks (such as maintenance interval synchronization, anomaly alerts, and billing draft updates) consume events reliably through the outbox worker (`JOB-01`) without distributed 2PC transactions.

---

## 4. Consequences

### Positive
- **Guaranteed Single Writer**: Zero danger of dual-master stock corruption or disparate pricing.
- **Resilient Event Stream**: Outbox events cannot be lost if downstream notification or worker services crash.
- **Transparent Frontend**: Attendants, site clerks, and office administrators experience identical UI responsiveness regardless of backend delegation mode.
- **Safe Rollback**: Reverting write authority from remote to local takes under 5 seconds by toggling `FUEL_WRITE_AUTHORITY=LOCAL_COMMAND`.

### Negative / Trade-offs
- In `REMOTE_API` mode, network hops introduce minor latency (~5–10ms) between the Next.js server and the .NET composition root.
