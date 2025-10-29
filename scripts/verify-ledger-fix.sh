#!/bin/bash

# Verification Script for Ledger Flow Fix
# This script creates a wallet and verifies ledger entries are created

set -e

echo "=========================================="
echo "Ledger Flow Verification Script"
echo "=========================================="
echo ""

# Configuration
WALLET_ID="verify-$(date +%s)"
OWNER_ID="user-verify"
INITIAL_BALANCE=500.00
API_URL="http://localhost:3000"

echo "📝 Test Configuration:"
echo "   Wallet ID: $WALLET_ID"
echo "   Owner ID: $OWNER_ID"
echo "   Initial Balance: $INITIAL_BALANCE"
echo ""

# Step 1: Create wallet
echo "🚀 Step 1: Creating wallet..."
RESPONSE=$(curl -s -X POST "$API_URL/wallets" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: verify-$(date +%s)" \
  -d "{
    \"walletId\": \"$WALLET_ID\",
    \"ownerId\": \"$OWNER_ID\",
    \"initialBalance\": $INITIAL_BALANCE
  }")

echo "✅ Wallet created:"
echo "$RESPONSE" | jq .
echo ""

# Extract wallet ID from response
CREATED_ID=$(echo "$RESPONSE" | jq -r '.id')
if [ "$CREATED_ID" != "$WALLET_ID" ]; then
  echo "❌ ERROR: Wallet ID mismatch!"
  exit 1
fi

# Step 2: Wait for async processing
echo "⏳ Step 2: Waiting 5 seconds for async projection..."
sleep 5
echo ""

# Step 3: Check ledger entries
echo "📊 Step 3: Checking ledger entries..."
LEDGER_RESPONSE=$(curl -s "$API_URL/ledger/wallet/$WALLET_ID")
echo "$LEDGER_RESPONSE" | jq .
echo ""

# Verify ledger entries count
LEDGER_COUNT=$(echo "$LEDGER_RESPONSE" | jq -r '.count')
echo "📈 Found $LEDGER_COUNT ledger entries"
echo ""

# Step 4: Verify results
echo "🔍 Step 4: Verifying results..."
if [ "$LEDGER_COUNT" -ge 1 ]; then
  echo "✅ SUCCESS: Ledger entries were created!"
  echo ""
  echo "📋 Summary:"
  echo "   - Wallet created: $WALLET_ID"
  echo "   - Initial balance: $INITIAL_BALANCE"
  echo "   - Ledger entries: $LEDGER_COUNT"
  echo ""
  echo "🎉 Ledger flow is working correctly!"
else
  echo "❌ FAILED: No ledger entries found!"
  echo ""
  echo "🔧 Troubleshooting:"
  echo "   1. Check projector logs: pm2 logs wallex | grep ledger-projector"
  echo "   2. Verify projectors are running: pm2 status wallex"
  echo "   3. Check for errors: pm2 logs wallex --err"
  exit 1
fi

echo ""
echo "=========================================="
echo "Verification Complete ✅"
echo "=========================================="

