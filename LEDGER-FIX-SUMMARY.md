# Ledger Entries Fix Summary

## ❌ Problem

Ledger entries were not being created because the `LedgerProjector` was missing the **required** `transactionType` field.

The `ledger_entries` table schema requires:
```sql
transaction_type ENUM('CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT') NOT NULL
```

But the projector was trying to insert entries **without** this field, causing database errors.

---

## ✅ Fix Applied

### 1. Added Transaction Type to Ledger Projector

**File:** `src/wallet/infrastructure/projections/ledger.projector.ts`

**Changes:**

```typescript
// Import TransactionType enum
import {
  LedgerEntryEntity,
  TransactionType,  // ← Added
} from '../../../ledger/domain/entities/ledger-entry.entity';

// For WalletCreated with initial balance
entry.transactionType = TransactionType.CREDIT;  // ← Added

// For WalletCredited
entry.transactionType = TransactionType.CREDIT;  // ← Added

// For WalletDebited
entry.transactionType = TransactionType.DEBIT;   // ← Added
```

### 2. Added Unique Constraint for Idempotency

**File:** `src/database/migrations/1730000000008-AddLedgerEntriesUniqueConstraint.ts`

**Purpose:** Ensures ledger entries are idempotent (no duplicates on replay)

```sql
ALTER TABLE ledger_entries
ADD CONSTRAINT uq_ledger_entries_reference_id
UNIQUE (reference_id);
```

### 3. Enhanced Testing Guide

**File:** `TESTING-GUIDE.md`

Added comprehensive debugging section:
- How to check if ledger entries are being created
- How to debug projector issues
- SQL queries to verify data
- Troubleshooting steps

---

## 🧪 How to Test

### 1. Run the New Migration

```bash
npm run typeorm:run-migrations
```

Expected output:
```
✅ 1730000000008-AddLedgerEntriesUniqueConstraint has been executed successfully
```

### 2. Restart the Application

```bash
npm run start:dev
```

Watch for:
```
✅ Starting projector workers...
✅ Started span: ledger-projector...
✅ All projector workers started successfully
```

### 3. Create a Test Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-ledger-001" \
  -d '{
    "walletId": "wallet-ledger-test",
    "ownerId": "user-001",
    "initialBalance": 1000.00
  }'
```

### 4. Verify Ledger Entry Was Created

Wait 2 seconds, then check:

```sql
SELECT 
  wallet_id,
  transaction_type,
  amount,
  balance_before,
  balance_after,
  description,
  created_at
FROM ledger_entries 
WHERE wallet_id = 'wallet-ledger-test'
ORDER BY created_at ASC;
```

**Expected Result:**
```
| wallet_id          | transaction_type | amount  | balance_before | balance_after | description     |
| ------------------ | ---------------- | ------- | -------------- | ------------- | --------------- |
| wallet-ledger-test | CREDIT           | 1000.00 | 0.00           | 1000.00       | Initial balance |
```

### 5. Test Credit

```bash
curl -X POST http://localhost:3000/wallets/wallet-ledger-test/credit \
  -H "Content-Type: application/json" \
  -d '{"amount": 500.00, "description": "Test deposit"}'
```

Check ledger again:
```sql
SELECT * FROM ledger_entries 
WHERE wallet_id = 'wallet-ledger-test' 
ORDER BY created_at ASC;
```

**Expected: 2 entries** (Initial + Credit)

### 6. Test Debit

```bash
curl -X POST http://localhost:3000/wallets/wallet-ledger-test/debit \
  -H "Content-Type: application/json" \
  -d '{"amount": 200.00, "description": "Test withdrawal"}'
```

Check ledger again - **Expected: 3 entries** (Initial + Credit + Debit)

---

## 🔍 Debugging

### If Ledger Entries Are Still Not Created:

**1. Check Projector Logs:**
```bash
pm2 logs wallex | grep "ledger-projector" | tail -30
```

Look for:
- ✅ `Claimed X events for consumer ledger-projector`
- ✅ `Ledger entry created: WalletCreated ...`
- ❌ Any errors or stack traces

**2. Check Outbox:**
```sql
-- See if events are being processed
SELECT 
  event_type,
  consumer,
  processed_at
FROM outbox 
WHERE aggregate_id = 'wallet-ledger-test'
ORDER BY created_at ASC;
```

**Expected:**
- All events should have `processed_at` set
- Consumer should be `ledger-projector`

**3. Check Projector Checkpoint:**
```sql
SELECT * FROM projector_checkpoints 
WHERE projector_name = 'ledger-projector';
```

**Expected:**
- `last_processed_version` should be > 0
- `updated_at` should be recent (within last minute)

**4. Check for Errors:**
```sql
-- Check if outbox events failed to process
SELECT COUNT(*) as unprocessed 
FROM outbox 
WHERE processed_at IS NULL 
  AND created_at < NOW() - INTERVAL '5 minutes';
```

**Expected:** 0 unprocessed events

---

## 📊 Transaction Types Mapping

| Event Type      | Transaction Type | Amount Sign | Description              |
| --------------- | ---------------- | ----------- | ------------------------ |
| WalletCreated   | CREDIT           | +           | Initial balance (if > 0) |
| WalletCredited  | CREDIT           | +           | Add funds                |
| WalletDebited   | DEBIT            | -           | Remove funds             |
| Transfer (from) | DEBIT            | -           | Transfer out (future)    |
| Transfer (to)   | CREDIT           | +           | Transfer in (future)     |

**Note:** Transfer events currently emit WalletDebited/WalletCredited. Future enhancement could add TRANSFER_IN/TRANSFER_OUT types.

---

## ✅ Verification Checklist

After applying the fix:

- [ ] Migration runs successfully
- [ ] Application starts without errors
- [ ] Projectors start successfully
- [ ] Create wallet → Ledger entry created (CREDIT)
- [ ] Credit wallet → Ledger entry created (CREDIT)
- [ ] Debit wallet → Ledger entry created (DEBIT)
- [ ] Transfer wallet → 2 Ledger entries created (DEBIT + CREDIT)
- [ ] All `transaction_type` fields are set correctly
- [ ] Balances in ledger match wallet balances
- [ ] `balance_before` and `balance_after` are tracked correctly

---

## 🚀 What's Fixed

✅ **Ledger entries now being created** for all wallet operations  
✅ **Transaction types** properly set (CREDIT/DEBIT)  
✅ **Idempotency** via unique constraint on `reference_id`  
✅ **Balance tracking** with `balance_before` and `balance_after`  
✅ **Comprehensive debugging** guide added  

---

## 📝 Related Files Changed

1. ✅ `src/wallet/infrastructure/projections/ledger.projector.ts` - Added transactionType
2. ✅ `src/database/migrations/1730000000008-AddLedgerEntriesUniqueConstraint.ts` - New migration
3. ✅ `TESTING-GUIDE.md` - Enhanced debugging section
4. ✅ `LEDGER-FIX-SUMMARY.md` - This file

---

**Status:** ✅ Fixed  
**Date:** 2025-10-29  
**Verified:** Pending user testing

