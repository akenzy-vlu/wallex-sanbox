#!/bin/bash

# Script to create a test wallet with high initial balance for load testing
# Usage: ./setup-test-wallet.sh [walletId] [initialBalance]

WALLET_ID=${1:-"test-wallet"}
INITIAL_BALANCE=${2:-100000}
OWNER_ID=${3:-"load-test-user"}
BASE_URL=${4:-"http://localhost:3000"}

echo "=========================================="
echo "Creating Test Wallet"
echo "=========================================="
echo "Wallet ID: $WALLET_ID"
echo "Owner ID: $OWNER_ID"
echo "Initial Balance: $INITIAL_BALANCE"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# Create the wallet
response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/wallets" \
    -H "Content-Type: application/json" \
    -d "{\"walletId\":\"$WALLET_ID\",\"ownerId\":\"$OWNER_ID\",\"initialBalance\":$INITIAL_BALANCE}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "✓ Wallet created successfully!"
    echo ""
    echo "Wallet Details:"
    echo "$body" | jq '.' || echo "$body"
    echo ""
    echo "=========================================="
    echo "You can now run load tests on this wallet:"
    echo "  ./spam-credit.sh $WALLET_ID 1000 10"
    echo "  ./spam-debit.sh $WALLET_ID 1000 5"
    echo "=========================================="
elif [ "$http_code" = "409" ]; then
    echo "⚠ Wallet already exists. Fetching current state..."
    echo ""
    wallet_state=$(curl -s "$BASE_URL/wallets/$WALLET_ID")
    echo "Current Wallet State:"
    echo "$wallet_state" | jq '.' || echo "$wallet_state"
    echo ""
    echo "=========================================="
    echo "You can run load tests on this wallet:"
    echo "  ./spam-credit.sh $WALLET_ID 1000 10"
    echo "  ./spam-debit.sh $WALLET_ID 1000 5"
    echo "=========================================="
else
    echo "✗ Failed to create wallet (HTTP $http_code)"
    echo "Error: $body"
    exit 1
fi

