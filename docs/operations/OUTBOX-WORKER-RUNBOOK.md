# Outbox Worker & Replay Operations Runbook (JOB-01)

**System:** Fuel-System-V2 Enterprise ERP  
**Module:** Transactional Outbox & Background Processing (`apps/worker`, `src/lib/worker`)  
**Target Database:** PostgreSQL 16+ (`outbox_messages` table)  
**Revision:** Wave D — Backend Replacement

---

## 1. Architectural Overview

The **Transactional Outbox Pattern** ensures at-least-once delivery of domain events without distributed two-phase commit (2PC) transactions:

```
[ Domain Command ]
        │
        ▼ (Single DB Transaction)
┌───────────────────────────────────────┐
│ 1. Mutate Aggregates (Stock, Meter)  │
│ 2. Append AuditLog                    │
│ 3. Insert outbox_messages             │
└───────────────────┬───────────────────┘
                    │ COMMIT
                    ▼
[ PostgreSQL: outbox_messages ]
        │
        │ Poll (FOR UPDATE SKIP LOCKED)
        ▼
[ Outbox Worker ] ──── Dispatch ────► [ Idempotent Consumers ]
        │                                      │
        ▼                                      ▼
[ Acknowledge processed_at ]           [ Deduplication Store ]
```

---

## 2. Retry Policy & Exponential Backoff

When a consumer handler fails with a transient exception, the message remains unacknowledged, its `retry_count` is incremented, and its `last_error` is recorded. Subsequent processing attempts are gated by exponential backoff.

### Backoff Schedule:
- **Base Delay:** 1,000 ms (1 second)
- **Backoff Multiplier:** 2.0x
- **Maximum Delay:** 60,000 ms (60 seconds)
- **Max Retries Threshold:** 5 attempts

| Attempt | Elapsed Backoff Window | Action |
| :--- | :--- | :--- |
| **Attempt 1** | Immediate (0 ms) | Normal delivery |
| **Attempt 2** | +1,000 ms (1s) | First retry |
| **Attempt 3** | +2,000 ms (2s) | Second retry |
| **Attempt 4** | +4,000 ms (4s) | Third retry |
| **Attempt 5** | +8,000 ms (8s) | Fourth retry |
| **Exhausted** | Dead Letter Queue | Quarantined (`[DEAD_LETTER]` prefixed) |

---

## 3. Dead-Letter Queue (DLQ) & Poison Pill Quarantine

A message that fails 5 consecutive attempts is automatically quarantined:
- Marked with `[DEAD_LETTER]` prefix in `last_error`.
- Excluded from normal high-frequency polling loops (`retry_count < 5`).
- **Zero Head-of-Line Blocking**: A single corrupted or un-processable payload will never block subsequent healthy messages in the queue.

---

## 4. Idempotent Consumer Protection (Replay Safety)

Master Plan Section 13 strictly dictates:
> *"Outbox replay: No repeated business or external posting."*

To satisfy this, all consumers are wrapped with the **`IdempotentConsumerRegistry`**:
- Each consumer checks `(consumerName, messageId)` in the deduplication log before executing side effects.
- If previously acknowledged, the delivery returns immediately as an **Idempotent No-Op**.
- No duplicate external webhooks, email dispatches, or external financial postings can ever occur.

---

## 5. PostgreSQL Diagnostic & Monitoring Queries

### 5.1 Check Unprocessed Backlog Depth
```sql
SELECT 
    COUNT(*) AS pending_count,
    MIN(created_at) AS oldest_pending_message,
    NOW() - MIN(created_at) AS max_lag_duration
FROM outbox_messages
WHERE processed_at IS NULL AND retry_count < 5;
```

### 5.2 Inspect Quarantined Dead-Letter Messages
```sql
SELECT 
    id, event_type, aggregate_type, aggregate_id, retry_count, last_error, created_at
FROM outbox_messages
WHERE processed_at IS NULL AND retry_count >= 5
ORDER BY created_at DESC;
```

### 5.3 Consumer Performance & Processing Throughput (Last 1 Hour)
```sql
SELECT 
    event_type,
    COUNT(*) AS processed_count,
    AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) AS avg_processing_lag_seconds
FROM outbox_messages
WHERE processed_at >= NOW() - INTERVAL '1 hour'
GROUP BY event_type;
```

---

## 6. Dead-Letter Replay Procedure

Once the underlying issue (e.g. network outage, consumer bug) has been resolved:

### Step 1: Re-queue Quarantined Messages
```sql
UPDATE outbox_messages
SET 
    retry_count = 0,
    last_error = NULL
WHERE processed_at IS NULL AND retry_count >= 5;
```

### Step 2: Verify Consumer Replay
Observe the worker logs to confirm that all replayed messages process successfully and update `processed_at`. Verify that previously processed messages trigger idempotent no-op responses.
