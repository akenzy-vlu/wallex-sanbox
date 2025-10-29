# Async Projections - Testing Guide

## Quick Test Sequence

### 1. Create Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-create-001" \
  -d '{
    "walletId": "wallet-test-001",
    "ownerId": "user-001",
    "initialBalance": 1000.00
  }'
```

**Expected Response (201 Created):**
```json
{
  "id": "wallet-test-001",
  "ownerId": "user-001",
  "balance": 1000.00,
  "version": 1,
  "createdAt": "2025-10-29T...",
  "updatedAt": "2025-10-29T..."
}
```

### 2. Credit Wallet (+500)

```bash
curl -X POST http://localhost:3000/wallets/wallet-test-001/credit \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500.00,
    "description": "Deposit from bank"
  }'
```

**Expected Response:**
```json
{
  "id": "wallet-test-001",
  "ownerId": "user-001",
  "balance": 1500.00,  // ← 1000 + 500
  "version": 2,        // ← Incremented
  "createdAt": "2025-10-29T...",
  "updatedAt": "2025-10-29T..."
}
```

### 3. Debit Wallet (-200)

```bash
curl -X POST http://localhost:3000/wallets/wallet-test-001/debit \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 200.00,
    "description": "Withdrawal"
  }'
```

**Expected Response:**
```json
{
  "id": "wallet-test-001",
  "ownerId": "user-001",
  "balance": 1300.00,  // ← 1500 - 200
  "version": 3,        // ← Incremented
  "createdAt": "2025-10-29T...",
  "updatedAt": "2025-10-29T..."
}
```

### 4. Create Second Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-create-002" \
  -d '{
    "walletId": "wallet-test-002",
    "ownerId": "user-002",
    "initialBalance": 500.00
  }'
```

**Expected Response (201 Created):**
```json
{
  "id": "wallet-test-002",
  "ownerId": "user-002",
  "balance": 500.00,
  "version": 1,
  "createdAt": "2025-10-29T...",
  "updatedAt": "2025-10-29T..."
}
```

### 5. Transfer Between Wallets

```bash
curl -X POST http://localhost:3000/wallets/wallet-test-001/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "toWalletId": "wallet-test-002",
    "amount": 300.00,
    "description": "Payment for services"
  }'
```

**Expected Response:**
```json
{
  "fromWallet": {
    "id": "wallet-test-001",
    "ownerId": "user-001",
    "balance": 1000.00,   // ← 1300 - 300
    "version": 4,
    "createdAt": "2025-10-29T...",
    "updatedAt": "2025-10-29T..."
  },
  "toWallet": {
    "id": "wallet-test-002",
    "ownerId": "user-002",
    "balance": 800.00,    // ← 500 + 300
    "version": 2,
    "createdAt": "2025-10-29T...",
    "updatedAt": "2025-10-29T..."
  }
}
```

---

## Verify Projections

### Check Outbox (Should Process Quickly)

```sql
-- Check for unprocessed events
SELECT 
  id,
  aggregate_id,
  event_type,
  consumer,
  created_at,
  processed_at
FROM outbox 
ORDER BY created_at DESC 
LIMIT 10;
```

**Expected:** All events processed within 1-2 seconds (processed_at set)

**Debug: Check outbox status:**
```sql
-- Count unprocessed events
SELECT COUNT(*) as unprocessed FROM outbox WHERE processed_at IS NULL;

-- Count by consumer
SELECT 
  consumer,
  COUNT(*) as processed_count
FROM outbox 
WHERE processed_at IS NOT NULL
GROUP BY consumer;

-- Check for errors (events not claimed)
SELECT 
  id,
  aggregate_id,
  event_type,
  created_at,
  NOW() - created_at as age
FROM outbox 
WHERE processed_at IS NULL
ORDER BY created_at ASC;
```

### Check Read Model

```bash
# Query read model (eventual consistency)
curl http://localhost:3000/wallets/wallet-test-001
```

**Expected (after ~1 second):**
```json
{
  "id": "wallet-test-001",
  "ownerId": "user-001",
  "balance": 1000.00,
  "createdAt": "2025-10-29T...",
  "updatedAt": "2025-10-29T..."
}
```

### Check Ledger Entries

```sql
-- View ledger for wallet (full details)
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
WHERE wallet_id = 'wallet-test-001'
ORDER BY created_at ASC;
```

**Expected Output:**
```
| transaction_type | amount  | balance_before | balance_after | description          |
| ---------------- | ------- | -------------- | ------------- | -------------------- |
| CREDIT           | 1000.00 | 0.00           | 1000.00       | Initial balance      |
| CREDIT           | 500.00  | 1000.00        | 1500.00       | Deposit from bank    |
| DEBIT            | 200.00  | 1500.00        | 1300.00       | Withdrawal           |
| DEBIT            | 300.00  | 1300.00        | 1000.00       | Payment for services |
```

**Debug: Check if entries are being created:**
```sql
-- Count total ledger entries
SELECT COUNT(*) as total_entries FROM ledger_entries;

-- Check latest entries
SELECT 
  wallet_id,
  transaction_type,
  amount,
  description,
  created_at
FROM ledger_entries 
ORDER BY created_at DESC 
LIMIT 10;

-- Check for specific wallet
SELECT COUNT(*) as entries_for_wallet
FROM ledger_entries 
WHERE wallet_id = 'wallet-test-001';
```

---

## Error Cases

### 1. Insufficient Funds

```bash
curl -X POST http://localhost:3000/wallets/wallet-test-001/debit \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000.00,
    "description": "Too much!"
  }'
```

**Expected:** 400 Bad Request - "Insufficient funds"

### 2. Duplicate Idempotency Key

```bash
# Send same request twice with same idempotency key
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-create-001" \
  -d '{
    "walletId": "wallet-test-003",
    "ownerId": "user-003",
    "initialBalance": 100.00
  }'
```

**Expected:** Returns cached response from first request (wallet-test-001, not 003)

### 3. Transfer to Same Wallet

```bash
curl -X POST http://localhost:3000/wallets/wallet-test-001/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "toWalletId": "wallet-test-001",
    "amount": 100.00
  }'
```

**Expected:** 400 Bad Request - "Cannot transfer to the same wallet"

### 4. Wallet Not Found

```bash
curl -X POST http://localhost:3000/wallets/non-existent/credit \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00
  }'
```

**Expected:** 404 Not Found - "Wallet not found"

---

## Performance Testing

### Load Test Script

```bash
#!/bin/bash
# Create 100 wallets concurrently

for i in {1..100}; do
  curl -X POST http://localhost:3000/wallets \
    -H "Content-Type: application/json" \
    -H "Idempotency-Key: load-test-$i" \
    -d "{
      \"walletId\": \"wallet-load-$i\",
      \"ownerId\": \"user-load-$i\",
      \"initialBalance\": 1000.00
    }" &
done

wait
echo "All wallets created!"
```

### Monitor Outbox Lag

```sql
-- Run this periodically during load test
SELECT 
  COUNT(*) as unprocessed_events,
  MIN(created_at) as oldest_event,
  NOW() - MIN(created_at) as lag
FROM outbox
WHERE processed_at IS NULL;
```

**Expected:**
- unprocessed_events: < 1000
- lag: < 10 seconds

### Check Projector Health

```sql
SELECT 
  projector_name,
  last_processed_version,
  last_processed_at,
  updated_at
FROM projector_checkpoints;
```

**Expected:** Both projectors actively updating (updated_at recent)

---

## Cleanup

```bash
# Delete test wallets
psql -d wallex -c "DELETE FROM wallets WHERE id LIKE 'wallet-test-%';"
psql -d wallex -c "DELETE FROM wallets WHERE id LIKE 'wallet-load-%';"
psql -d wallex -c "DELETE FROM outbox WHERE aggregate_id LIKE 'wallet-test-%';"
psql -d wallex -c "DELETE FROM outbox WHERE aggregate_id LIKE 'wallet-load-%';"
psql -d wallex -c "DELETE FROM ledger_entries WHERE wallet_id LIKE 'wallet-test-%';"
psql -d wallex -c "DELETE FROM ledger_entries WHERE wallet_id LIKE 'wallet-load-%';"
```

---

## Troubleshooting

### Ledger Entries Not Being Created

**1. Check if projector is running:**
```bash
# Look for ledger projector logs
pm2 logs wallex | grep "ledger-projector"
```

**2. Check for errors in projector:**
```bash
# Look for specific errors
pm2 logs wallex | grep "Ledger entry" | tail -20
```

**3. Verify events are in outbox:**
```sql
-- Check if WalletCreated/Credited/Debited events exist
SELECT 
  id,
  aggregate_id,
  event_type,
  consumer,
  processed_at,
  created_at
FROM outbox 
WHERE event_type IN ('WalletCreated', 'WalletCredited', 'WalletDebited')
ORDER BY created_at DESC 
LIMIT 20;
```

**4. Check projector checkpoint:**
```sql
-- See if ledger projector is processing
SELECT * FROM projector_checkpoints WHERE projector_name = 'ledger-projector';
```

**5. Manually verify event payload:**
```sql
-- Check event payload structure
SELECT 
  event_type,
  payload,
  metadata
FROM outbox 
WHERE aggregate_id = 'wallet-test-001'
ORDER BY created_at ASC;
```

**6. Check for duplicate key errors:**
```bash
# Look for constraint violation errors
pm2 logs wallex | grep "23505" | tail -10
```

**7. Restart ledger projector:**
```bash
# Restart the application to restart projectors
pm2 restart wallex
```

### Projectors Not Processing

**Check logs:**
```bash
# Look for projector errors
pm2 logs wallex | grep "projectorWorker"
```

**Check projector status:**
```sql
-- See if checkpoints are updating
SELECT * FROM projector_checkpoints;
```

**Manual retry:**
```bash
# Via recovery service (if accessible)
curl -X POST http://localhost:3000/admin/recovery/retry-stale
```

### Outbox Growing

**Check unprocessed count:**
```sql
SELECT COUNT(*) FROM outbox WHERE processed_at IS NULL;
```

**If growing:**
1. Check projector logs for errors
2. Restart projectors: `pm2 restart wallex`
3. Manual retry: Use recovery service

### Data Drift

**Detect drift:**
```sql
SELECT 
  w.id,
  w.balance as write_balance,
  rm.balance as read_balance,
  ABS(w.balance - rm.balance) as drift
FROM wallets w
LEFT JOIN wallets_read_model rm ON w.id = rm.id
WHERE ABS(w.balance - rm.balance) > 0.01;
```

**Fix drift:**
```bash
# Rebuild from event store
await recoveryService.rebuildWalletReadModel('wallet-id');
```

---

**Last Updated:** 2025-10-29  
**Status:** Ready for Testing

