# Debug Ledger Flow - Step by Step

## Step 1: Create a Test Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: debug-test-001" \
  -d '{
    "walletId": "debug-wallet-001",
    "ownerId": "debug-user-001",
    "initialBalance": 100.00
  }'
```

## Step 2: Check Application Logs

```bash
# Check if events were enqueued
pm2 logs wallex | grep "Events enqueued to outbox"

# Check if projectors are claiming events
pm2 logs wallex | grep "Claimed.*events for consumer"

# Check for ledger projector specifically
pm2 logs wallex | grep "ledger-projector"

# Check for any errors
pm2 logs wallex | grep "ERROR" | tail -20
```

## Step 3: Check Outbox Table

```sql
-- Check if events were inserted into outbox
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

**Expected Result:**
- At least 1-2 events (WalletCreated, and WalletCredited if initialBalance > 0)
- `created_at` should be set
- `processed_at` should be set within 1-2 seconds
- `consumer` should show `ledger-projector` and `read-model-projector`

## Step 4: Check Event Payload

```sql
-- Check the actual event data
SELECT 
  event_type,
  payload,
  metadata
FROM outbox 
WHERE aggregate_id = 'debug-wallet-001'
ORDER BY id ASC;
```

**Look for:**
- `payload.data` should contain wallet data
- `payload.data.initialBalance` for WalletCreated
- `payload.data.amount` for WalletCredited

## Step 5: Check Projector Checkpoints

```sql
-- Check if ledger projector is processing
SELECT 
  projector_name,
  aggregate_id,
  last_processed_version,
  last_processed_id,
  last_processed_at,
  updated_at
FROM projector_checkpoints
WHERE projector_name = 'ledger-projector';
```

**Expected:**
- `last_processed_id` should be increasing
- `updated_at` should be recent (< 1 minute ago)

## Step 6: Check Ledger Entries

```sql
-- Check if ledger entry was created
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

**Expected:**
- At least 1 entry if initialBalance > 0
- `transaction_type` should be 'CREDIT'
- `amount` should be 100.00
- `balance_before` should be 0.00
- `balance_after` should be 100.00

## Step 7: Manual Event Check (If Ledger Empty)

If ledger is empty, manually check the outbox payload:

```sql
-- Get the full event payload
SELECT 
  id,
  event_type,
  payload::text,
  metadata::text
FROM outbox 
WHERE aggregate_id = 'debug-wallet-001' 
  AND event_type = 'WalletCreated'
LIMIT 1;
```

Look at the payload structure. It should look like:
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

## Step 8: Check Projector Logs for Errors

```bash
# Look for ledger projection errors
pm2 logs wallex | grep -A 5 "ledger-projector.*ERROR"

# Look for duplicate key errors (23505)
pm2 logs wallex | grep "23505"

# Look for transaction type errors
pm2 logs wallex | grep "transaction"

