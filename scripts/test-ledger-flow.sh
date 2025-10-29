#!/bin/bash

# Test Ledger Flow - Complete Verification Script
# This script tests the entire wallet creation → ledger entry flow

echo "===================================="
echo "Ledger Flow Test"
echo "===================================="
echo ""

# Configuration
WALLET_ID="test-ledger-$(date +%s)"
OWNER_ID="test-user-001"
INITIAL_BALANCE=100.00
API_URL="http://localhost:3000"

echo "Test Configuration:"
echo "  Wallet ID: $WALLET_ID"
echo "  Owner ID: $OWNER_ID"
echo "  Initial Balance: $INITIAL_BALANCE"
echo ""

# Step 1: Create wallet
echo "Step 1: Creating wallet..."
RESPONSE=$(curl -s -X POST "$API_URL/wallets" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-$(date +%s)" \
  -d "{
    \"walletId\": \"$WALLET_ID\",
    \"ownerId\": \"$OWNER_ID\",
    \"initialBalance\": $INITIAL_BALANCE
  }")

echo "Response: $RESPONSE"
echo ""

# Step 2: Wait for async processing
echo "Step 2: Waiting 3 seconds for async processing..."
sleep 3
echo ""

# Step 3: Check outbox
echo "Step 3: Checking outbox for events..."
psql -d wallex -c "
SELECT 
  id,
  event_type,
  consumer,
  processed_at IS NOT NULL as processed
FROM outbox 
WHERE aggregate_id = '$WALLET_ID'
ORDER BY id ASC;
"
echo ""

# Step 4: Check event payload
echo "Step 4: Checking event payload structure..."
psql -d wallex -c "
SELECT 
  event_type,
  payload::text as payload
FROM outbox 
WHERE aggregate_id = '$WALLET_ID' 
  AND event_type = 'WalletCreated'
LIMIT 1;
"
echo ""

# Step 5: Check projector checkpoint
echo "Step 5: Checking ledger projector checkpoint..."
psql -d wallex -c "
SELECT 
  projector_name,
  last_processed_id,
  last_processed_at,
  updated_at
FROM projector_checkpoints
WHERE projector_name = 'ledger-projector';
"
echo ""

# Step 6: Check ledger entries
echo "Step 6: Checking ledger entries..."
LEDGER_COUNT=$(psql -t -d wallex -c "
SELECT COUNT(*) 
FROM ledger_entries 
WHERE wallet_id = '$WALLET_ID';
")

echo "Ledger entries found: $LEDGER_COUNT"

if [ "$LEDGER_COUNT" -gt 0 ]; then
  echo "✅ SUCCESS: Ledger entries created!"
  psql -d wallex -c "
  SELECT 
    wallet_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    description
  FROM ledger_entries 
  WHERE wallet_id = '$WALLET_ID'
  ORDER BY created_at ASC;
  "
else
  echo "❌ FAILED: No ledger entries found!"
  echo ""
  echo "Debugging information:"
  echo "----------------------"
  
  # Check if outbox events were processed
  PROCESSED_COUNT=$(psql -t -d wallex -c "
  SELECT COUNT(*) 
  FROM outbox 
  WHERE aggregate_id = '$WALLET_ID' 
    AND processed_at IS NOT NULL 
    AND consumer = 'ledger-projector';
  ")
  
  echo "Processed outbox events: $PROCESSED_COUNT"
  
  if [ "$PROCESSED_COUNT" -eq 0 ]; then
    echo "❌ Events not processed by ledger projector"
    echo "   Check if projector is running: pm2 logs wallex | grep 'ledger-projector'"
  else
    echo "✅ Events were processed"
    echo "❌ But ledger entry not created - check projector logs for errors"
    echo "   Run: pm2 logs wallex | grep 'ledger' | tail -30"
  fi
fi

echo ""
echo "===================================="
echo "Test Complete"
echo "===================================="

