#!/bin/bash

# Script to run mixed load test (credit + debit operations)
# Usage: ./mixed-load-test.sh <walletId> <numberOfRequests> [creditAmount] [debitAmount]

WALLET_ID=${1:-"test-wallet"}
NUM_REQUESTS=${2:-1000}
CREDIT_AMOUNT=${3:-20}
DEBIT_AMOUNT=${4:-10}
BASE_URL=${5:-"http://localhost:3000"}

echo "=========================================="
echo "Mixed Load Test (Credit + Debit)"
echo "=========================================="
echo "Wallet ID: $WALLET_ID"
echo "Total Requests: $NUM_REQUESTS (50% credit, 50% debit)"
echo "Credit Amount: $CREDIT_AMOUNT"
echo "Debit Amount: $DEBIT_AMOUNT"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

CREDIT_SUCCESS=0
CREDIT_FAILURE=0
DEBIT_SUCCESS=0
DEBIT_FAILURE=0
START_TIME=$(date +%s)

# Get initial balance
echo "Fetching initial balance..."
INITIAL_STATE=$(curl -s "$BASE_URL/wallets/$WALLET_ID")
INITIAL_BALANCE=$(echo "$INITIAL_STATE" | jq -r '.balance' 2>/dev/null || echo "unknown")
echo "Initial Balance: $INITIAL_BALANCE"
echo ""

# Function to send credit request
send_credit_request() {
    local request_num=$1
    local response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/wallets/$WALLET_ID/credit" \
        -H "Content-Type: application/json" \
        -d "{\"amount\":$CREDIT_AMOUNT,\"description\":\"Mixed test credit #$request_num\"}")
    
    local http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        ((CREDIT_SUCCESS++))
    else
        ((CREDIT_FAILURE++))
    fi
}

# Function to send debit request
send_debit_request() {
    local request_num=$1
    local response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/wallets/$WALLET_ID/debit" \
        -H "Content-Type: application/json" \
        -d "{\"amount\":$DEBIT_AMOUNT,\"description\":\"Mixed test debit #$request_num\"}")
    
    local http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
        ((DEBIT_SUCCESS++))
    else
        ((DEBIT_FAILURE++))
    fi
}

# Send mixed requests
echo "Starting mixed load test..."
echo ""

for i in $(seq 1 $NUM_REQUESTS); do
    # Alternate between credit and debit (or randomize)
    if [ $((i % 2)) -eq 0 ]; then
        send_credit_request $i &
    else
        send_debit_request $i &
    fi
    
    # Progress indicator every 100 requests
    if [ $((i % 100)) -eq 0 ]; then
        echo "Progress: $i/$NUM_REQUESTS requests sent..."
    fi
    
    # Limit concurrent requests
    if [ $((i % 50)) -eq 0 ]; then
        wait
    fi
done

# Wait for all background processes to complete
wait

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

# Get final balance
echo ""
echo "Fetching final balance..."
FINAL_STATE=$(curl -s "$BASE_URL/wallets/$WALLET_ID")
FINAL_BALANCE=$(echo "$FINAL_STATE" | jq -r '.balance' 2>/dev/null || echo "unknown")

echo ""
echo "=========================================="
echo "Test Completed!"
echo "=========================================="
echo "Total Requests: $NUM_REQUESTS"
echo ""
echo "Credit Operations:"
echo "  Successful: $CREDIT_SUCCESS"
echo "  Failed: $CREDIT_FAILURE"
echo ""
echo "Debit Operations:"
echo "  Successful: $DEBIT_SUCCESS"
echo "  Failed: $DEBIT_FAILURE"
echo ""
echo "Overall:"
echo "  Total Success: $((CREDIT_SUCCESS + DEBIT_SUCCESS))"
echo "  Total Failed: $((CREDIT_FAILURE + DEBIT_FAILURE))"
echo "  Duration: ${DURATION}s"
echo "  Requests per second: $((NUM_REQUESTS / DURATION))"
echo ""
echo "Balance:"
echo "  Initial: $INITIAL_BALANCE"
echo "  Final: $FINAL_BALANCE"
if [ "$INITIAL_BALANCE" != "unknown" ] && [ "$FINAL_BALANCE" != "unknown" ]; then
    EXPECTED_CHANGE=$((CREDIT_SUCCESS * CREDIT_AMOUNT - DEBIT_SUCCESS * DEBIT_AMOUNT))
    ACTUAL_CHANGE=$(echo "$FINAL_BALANCE - $INITIAL_BALANCE" | bc 2>/dev/null || echo "N/A")
    echo "  Expected Change: $EXPECTED_CHANGE"
    echo "  Actual Change: $ACTUAL_CHANGE"
fi
echo "=========================================="

echo ""
echo "Final wallet state:"
echo "$FINAL_STATE" | jq '.' || echo "$FINAL_STATE"

