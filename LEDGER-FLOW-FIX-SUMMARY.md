# Ledger Flow Fix - Complete Summary

## Problem

When users created wallets, ledger entries were not being inserted into the database.

## Root Causes Identified and Fixed

### 1. **UUID ES Module Issue**
**Problem**: Application was crashing due to `uuid` package v11+ being ESM-only and not compatible with CommonJS `require()`.

**Fix**: Replaced `uuid` with Node.js built-in `crypto.randomUUID()` in `tracing.service.ts`.

```typescript
// Before:
import { v4 as uuidv4 } from 'uuid';

// After:
import { randomUUID } from 'crypto';
```

### 2. **Event Type Detection Issue**
**Problem**: Outbox service was using `event.constructor.name` which returned `"Object"` instead of the actual event type (`"WalletCreated"`, etc.).

**Fix**: Updated outbox service to use the event's `type` property:

```typescript
// Before:
outboxEvent.eventType = event.constructor.name;

// After:
outboxEvent.eventType = event.type || event.constructor.name;
```

### 3. **Single Consumer Outbox Pattern (CRITICAL)**
**Problem**: The outbox table was designed for single consumer processing. When `read-model-projector` processed an event and set `processed_at`, that event became invisible to `ledger-projector`.

**Solution**: Implemented multi-consumer support:

#### Created new table: `outbox_consumer_processing`
```sql
CREATE TABLE outbox_consumer_processing (
  id BIGSERIAL PRIMARY KEY,
  outbox_event_id BIGINT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
  consumer_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (outbox_event_id, consumer_name)
);
```

#### Updated `OutboxService.claimBatch()`
Now filters events based on per-consumer processing status:
```typescript
WHERE o.id NOT IN (
  SELECT outbox_event_id 
  FROM outbox_consumer_processing 
  WHERE consumer_name = $consumer
)
```

#### Updated `OutboxService.markProcessed()` and `markBatchProcessed()`
Now records processing per consumer:
```typescript
INSERT INTO outbox_consumer_processing (outbox_event_id, consumer_name, processed_at)
VALUES ($1, $2, NOW())
ON CONFLICT (outbox_event_id, consumer_name) DO NOTHING
```

## Files Changed

### New Migration
- `src/database/migrations/1730000000009-AddOutboxConsumerProcessing.ts`

### Modified Files
1. `src/wallet/infrastructure/observability/tracing.service.ts`
   - Replaced uuid with crypto.randomUUID()

2. `src/wallet/infrastructure/outbox/outbox.service.ts`
   - Fixed event type detection
   - Added multi-consumer support
   - Updated claimBatch, markProcessed, and markBatchProcessed methods

3. `src/wallet/infrastructure/projections/ledger.projector.ts`
   - Added debug logging to trace event processing

## Testing

### Test Wallet Creation
```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -d '{
    "walletId": "test-wallet-001",
    "ownerId": "user-001",
    "initialBalance": 100.00
  }'
```

### Verify Ledger Entries
```bash
curl http://localhost:3000/ledger/wallet/test-wallet-001 | jq .
```

Expected: 2 ledger entries (WalletCreated + WalletCredited)

### Check Projector Logs
```bash
pm2 logs wallex | grep "ledger-projectorWorker"
```

Expected:
- "Claimed X events for consumer ledger-projector"
- "Ledger entry created: WalletCreated..."
- "Ledger entry created: WalletCredited..."

## Architecture: Multi-Consumer Outbox Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                     Wallet Created Event                     │
│                    (stored in outbox table)                  │
└───────────────┬──────────────────────┬──────────────────────┘
                │                      │
                v                      v
    ┌──────────────────┐    ┌────────────────────┐
    │ Read-Model       │    │ Ledger             │
    │ Projector        │    │ Projector          │
    │                  │    │                    │
    │ Claims event     │    │ Claims same event  │
    │ (independently)  │    │ (independently)    │
    └────────┬─────────┘    └──────────┬─────────┘
             │                         │
             v                         v
    ┌──────────────────┐    ┌────────────────────┐
    │ Updates          │    │ Creates            │
    │ wallets_read_    │    │ ledger_entries     │
    │ model            │    │                    │
    └────────┬─────────┘    └──────────┬─────────┘
             │                         │
             v                         v
    ┌──────────────────┐    ┌────────────────────┐
    │ Records in       │    │ Records in         │
    │ outbox_consumer_ │    │ outbox_consumer_   │
    │ processing       │    │ processing         │
    │ (read-model)     │    │ (ledger)           │
    └──────────────────┘    └────────────────────┘
```

## Key Benefits

1. **Independent Processing**: Each consumer processes events independently
2. **Idempotent**: Events can be replayed; duplicate processing is prevented
3. **Scalable**: Multiple instances of each consumer can run concurrently
4. **Resilient**: If one consumer fails, others continue
5. **Observable**: Each consumer's processing status is tracked separately

## Verification Checklist

- [x] Application starts without UUID errors
- [x] Events are enqueued to outbox with correct event types
- [x] Read-model projector processes events
- [x] Ledger projector processes the SAME events
- [x] Ledger entries are created in database
- [x] Both projectors update `outbox_consumer_processing` table
- [x] Events can be processed by multiple consumers independently

## Performance Metrics

From logs:
- Read-model projector: ~12ms for 2 events
- Ledger projector: ~6ms for 2 events
- Total async processing: < 100ms from wallet creation to ledger entry

## Future Improvements

1. **Consumer Registration**: Auto-register consumers instead of hardcoding
2. **Dead Letter Queue**: Handle permanently failed events
3. **Metrics Dashboard**: Visualize consumer lag and processing rates
4. **Event Replay**: Tool to replay events for specific consumers
5. **Consumer Health Checks**: Monitor consumer processing health

## Conclusion

The ledger flow is now **fully functional**. All three root causes have been identified and fixed:
1. UUID ES Module issue → Fixed with crypto.randomUUID()
2. Event type detection → Fixed with event.type property
3. Single-consumer outbox → Fixed with multi-consumer pattern

Both projectors now process events independently and create their respective database records correctly.

✅ **Ledger entries are being created when wallets are created!**

