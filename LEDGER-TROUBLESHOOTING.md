# Ledger Troubleshooting Guide

## Issue: Ledger Entries Not Being Created

If ledger entries are not being inserted into the database when wallets are created, follow these steps to diagnose and fix the issue.

---

## Quick Diagnosis

Run the automated test script:

```bash
./scripts/test-ledger-flow.sh
```

This will:
1. Create a test wallet with initial balance
2. Wait for async processing
3. Check outbox, projector status, and ledger entries
4. Show detailed debugging info if it fails

---

## Manual Step-by-Step Diagnosis

### Step 1: Verify Application is Running

```bash
pm2 status wallex
```

**Expected**: Status should be "online"

### Step 2: Check if Projectors are Starting

```bash
pm2 logs wallex | grep "Starting projector"
```

**Expected Output**:
```
Starting projector: read-model-projector
Starting projector: ledger-projector
```

If projectors are not starting, check:
- Is `ProjectorBootstrapService` registered in `wallet.module.ts`?
- Are there any startup errors? Run: `pm2 logs wallex --err`

### Step 3: Create a Test Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: debug-$(date +%s)" \
  -d '{
    "walletId": "debug-wallet-001",
    "ownerId": "debug-user-001",
    "initialBalance": 100.00
  }'
```

### Step 4: Check Application Logs

```bash
# Check if events were enqueued
pm2 logs wallex | grep "Events enqueued to outbox"

# Check if projectors are claiming events
pm2 logs wallex | grep "Claimed.*events for consumer"

# Check ledger projector specifically
pm2 logs wallex | grep "ledger-projector"

# Check for errors
pm2 logs wallex --err | tail -30
```

**Expected**:
- "Events enqueued to outbox for wallet debug-wallet-001"
- "Claimed X events for consumer ledger-projector"
- "Applying event: WalletCreated for debug-wallet-001"
- "Ledger entry created: WalletCreated debug-wallet-001 +100"

### Step 5: Check Outbox Table

```sql
SELECT 
  id,
  aggregate_id,
  event_type,
  event_version,
  consumer,
  created_at,
  processed_at
FROM outbox 
WHERE aggregate_id = 'debug-wallet-001'
ORDER BY created_at ASC;
```

**Expected**:
- 1-2 events (WalletCreated, and WalletCredited if initialBalance > 0)
- `processed_at` should be set within 1-2 seconds
- `consumer` should show `ledger-projector`

**If `processed_at` is NULL**:
- Projectors are not running or not claiming events
- Check: `pm2 logs wallex | grep "Polling for events"`

### Step 6: Check Event Payload

```sql
SELECT 
  event_type,
  payload
FROM outbox 
WHERE aggregate_id = 'debug-wallet-001' 
  AND event_type = 'WalletCreated'
LIMIT 1;
```

**Expected Payload Structure**:
```json
{
  "type": "WalletCreated",
  "aggregateId": "debug-wallet-001",
  "data": {
    "ownerId": "debug-user-001",
    "initialBalance": 100
  }
}
```

**Common Issues**:
- `data` field is missing → Check event serialization in `OutboxService`
- `initialBalance` is `null` or `undefined` → Check `WalletAggregate.create()` method
- `initialBalance` is 0 when it should be 100 → Check API request payload

### Step 7: Check Projector Checkpoints

```sql
SELECT 
  projector_name,
  last_processed_id,
  last_processed_at,
  updated_at
FROM projector_checkpoints
WHERE projector_name = 'ledger-projector';
```

**Expected**:
- `last_processed_id` should be increasing over time
- `updated_at` should be recent (< 1 minute ago)

**If checkpoint is not updating**:
- Projector is stuck or not processing events
- Check for errors: `pm2 logs wallex | grep -A 10 "ledger-projector.*ERROR"`

### Step 8: Check Ledger Entries

```sql
SELECT 
  id,
  wallet_id,
  transaction_type,
  amount,
  balance_before,
  balance_after,
  description,
  reference_id,
  created_at
FROM ledger_entries 
WHERE wallet_id = 'debug-wallet-001'
ORDER BY created_at ASC;
```

**Expected** (for initialBalance = 100):
```
| wallet_id        | transaction_type | amount | balance_before | balance_after | description     |
| ---------------- | ---------------- | ------ | -------------- | ------------- | --------------- |
| debug-wallet-001 | CREDIT           | 100.00 | 0.00           | 100.00        | Initial balance |
```

**If no entries exist**:
- Events are being processed but not creating ledger entries
- Check projector logs for "Skipping ledger entry" messages
- Check if `initialBalance` is being extracted correctly

---

## Common Issues and Solutions

### Issue 1: Events Not Being Enqueued

**Symptoms**: No entries in `outbox` table after wallet creation

**Solution**:
1. Check if `OutboxService` is registered in `wallet.module.ts`
2. Check logs: `pm2 logs wallex | grep "Failed to enqueue"`
3. Verify database connection
4. Check if transaction is rolling back due to errors

### Issue 2: Projectors Not Processing Events

**Symptoms**: Events in `outbox` table, but `processed_at` is NULL

**Solution**:
1. Restart the application: `pm2 restart wallex`
2. Check if projectors are running: `pm2 logs wallex | grep "Starting projector"`
3. Check for polling logs: `pm2 logs wallex | grep "Polling for events"`
4. Verify `ProjectorBootstrapService` is running on app init

### Issue 3: Events Processed But No Ledger Entries

**Symptoms**: `outbox` events have `processed_at` set, but no `ledger_entries`

**Solution**:
1. Check projector logs for "Skipping ledger entry":
   ```bash
   pm2 logs wallex | grep "Skipping ledger entry"
   ```
2. If skipping, check the payload:
   ```sql
   SELECT payload->'data'->'initialBalance' 
   FROM outbox 
   WHERE aggregate_id = 'your-wallet-id';
   ```
3. If `initialBalance` is null/undefined, check `WalletAggregate.create()`:
   ```typescript
   // Should be:
   data: { ownerId, initialBalance }
   
   // NOT:
   data: { ownerId, initialBalance: initialBalance || undefined }
   ```

### Issue 4: Duplicate Key Errors

**Symptoms**: Logs show "duplicate key value violates unique constraint"

**Solution**:
This is expected for idempotency! The projector should catch and ignore these errors:
```typescript
if (error.code === '23505') {
  this.logger.debug('Ledger entry already exists');
  return;
}
```

### Issue 5: Missing `transactionType` Field

**Symptoms**: Error inserting into `ledger_entries` - `transactionType` is required

**Solution**: 
Ensure all event handlers set `transactionType`:
```typescript
entry.transactionType = TransactionType.CREDIT; // For WalletCreated and WalletCredited
entry.transactionType = TransactionType.DEBIT;  // For WalletDebited
```

---

## Verification After Fixes

After implementing any fixes:

1. **Rebuild and restart**:
   ```bash
   npm run build
   pm2 restart wallex
   ```

2. **Run migration** (if schema changed):
   ```bash
   npm run typeorm:run-migrations
   ```

3. **Clear old test data**:
   ```sql
   DELETE FROM outbox WHERE aggregate_id LIKE 'debug-%' OR aggregate_id LIKE 'test-%';
   DELETE FROM ledger_entries WHERE wallet_id LIKE 'debug-%' OR wallet_id LIKE 'test-%';
   DELETE FROM wallets_read_model WHERE id LIKE 'debug-%' OR id LIKE 'test-%';
   ```

4. **Run the test script**:
   ```bash
   ./scripts/test-ledger-flow.sh
   ```

5. **Verify all tables are updated**:
   ```sql
   -- Should have events
   SELECT COUNT(*) FROM outbox WHERE processed_at IS NOT NULL;
   
   -- Should have ledger entries
   SELECT COUNT(*) FROM ledger_entries;
   
   -- Should have read model entries
   SELECT COUNT(*) FROM wallets_read_model;
   ```

---

## Debug Logs Configuration

To enable detailed debug logs temporarily:

1. Set log level to debug in `main.ts`:
   ```typescript
   app.useLogger(['log', 'error', 'warn', 'debug']);
   ```

2. Restart:
   ```bash
   pm2 restart wallex
   ```

3. View debug logs:
   ```bash
   pm2 logs wallex | grep "DEBUG"
   ```

---

## Contact Points for Deep Debugging

If the issue persists:

1. **Check TypeORM Entities**: Ensure all entities are registered in both:
   - `src/database/data-source.ts`
   - `src/database/database.module.ts`

2. **Check Event Structure**: Log the actual event structure:
   ```typescript
   // In ledger.projector.ts
   this.logger.debug(`Full event: ${JSON.stringify(message, null, 2)}`);
   ```

3. **Check Database Permissions**: Ensure the app user has INSERT permissions:
   ```sql
   GRANT INSERT ON ledger_entries TO your_app_user;
   ```

4. **Check for Transaction Rollbacks**: Add transaction logging:
   ```typescript
   try {
     await this.ledgerRepo.insert(entry);
     this.logger.log('✅ Ledger entry inserted');
   } catch (error) {
     this.logger.error(`❌ Failed to insert: ${error.message}`, error.stack);
     throw error;
   }
   ```

