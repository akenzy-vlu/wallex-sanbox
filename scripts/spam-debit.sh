#!/bin/bash

# Script to spam debit operations on a wallet
# Usage: ./spam-debit.sh <walletId> <numberOfRequests> [amount]

WALLET_ID=${1:-"test-wallet"}
NUM_REQUESTS=${2:-1000}
AMOUNT=${3:-5}
BASE_URL=${4:-"http://localhost:3000"}

echo "=========================================="
echo "Debit Spam Test"
echo "=========================================="
echo "Wallet ID: $WALLET_ID"
echo "Number of Requests: $NUM_REQUESTS"
echo "Amount per request: $AMOUNT"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

SUCCESS_COUNT=0
FAILURE_COUNT=0
START_TIME=$(date +%s)

# Function to send debit request
send_debit_request() {
    local request_num=$1
    local response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/wallets/$WALLET_ID/debit" \
        -H "Content-Type: application/json" \
        -d "{\"amount\":$AMOUNT,\"description\":\"Load test debit #$request_num\"}")
    
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n-1)
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        ((SUCCESS_COUNT++))
        if [ $((request_num % 100)) -eq 0 ]; then
            echo "✓ Request $request_num: SUCCESS (HTTP $http_code)"
        fi
    else
        ((FAILURE_COUNT++))
        if [ $((request_num % 100)) -eq 0 ] || [ "$http_code" != "400" ]; then
            echo "✗ Request $request_num: FAILED (HTTP $http_code)"
        fi
    fi
}

# Send requests
echo "Starting debit spam test..."
echo ""

for i in $(seq 1 $NUM_REQUESTS); do
    send_debit_request $i &
    
    # Limit concurrent requests to avoid overwhelming the system
    if [ $((i % 50)) -eq 0 ]; then
        wait
    fi
done

# Wait for all background processes to complete
wait

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "=========================================="
echo "Test Completed!"
echo "=========================================="
echo "Total Requests: $NUM_REQUESTS"
echo "Successful: $SUCCESS_COUNT"
echo "Failed: $FAILURE_COUNT"
echo "Duration: ${DURATION}s"
echo "Requests per second: $((NUM_REQUESTS / DURATION))"
echo "=========================================="

# Get final wallet state
echo ""
echo "Final wallet state:"
curl -s "$BASE_URL/wallets/$WALLET_ID" | jq '.' || curl -s "$BASE_URL/wallets/$WALLET_ID"

