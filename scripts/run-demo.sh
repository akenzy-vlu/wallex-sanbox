#!/bin/bash

# Demo script to showcase all load testing capabilities
# Usage: ./run-demo.sh

set -e

WALLET_ID="demo-wallet-$(date +%s)"
BASE_URL="http://localhost:3000"

echo "=========================================="
echo "🚀 Wallex Load Testing Demo"
echo "=========================================="
echo ""

# Check if server is running
echo "📡 Checking if server is running..."
if ! curl -s "$BASE_URL/wallets" > /dev/null 2>&1; then
    echo "❌ Error: Server is not responding at $BASE_URL"
    echo "Please start the server with: yarn start:dev"
    exit 1
fi
echo "✅ Server is running!"
echo ""

# Step 1: Create test wallet
echo "=========================================="
echo "Step 1: Creating test wallet"
echo "=========================================="
./setup-test-wallet.sh "$WALLET_ID" 50000
sleep 2
echo ""

# Step 2: Run small credit test
echo "=========================================="
echo "Step 2: Running Credit Test (100 requests)"
echo "=========================================="
./spam-credit.sh "$WALLET_ID" 100 10
sleep 2
echo ""

# Step 3: Run small debit test
echo "=========================================="
echo "Step 3: Running Debit Test (100 requests)"
echo "=========================================="
./spam-debit.sh "$WALLET_ID" 100 5
sleep 2
echo ""

# Step 4: Run mixed test
echo "=========================================="
echo "Step 4: Running Mixed Test (200 requests)"
echo "=========================================="
./mixed-load-test.sh "$WALLET_ID" 200 15 8
sleep 2
echo ""

# Step 5: Run advanced Node.js test
echo "=========================================="
echo "Step 5: Running Advanced Test (500 requests)"
echo "=========================================="
if command -v node &> /dev/null; then
    node load-test.js --wallet "$WALLET_ID" --requests 500 --concurrent 50 --type mixed
else
    echo "⚠️  Node.js not found, skipping advanced test"
fi
echo ""

# Final state
echo "=========================================="
echo "🎉 Demo Complete!"
echo "=========================================="
echo ""
echo "Final wallet state:"
curl -s "$BASE_URL/wallets/$WALLET_ID" | jq '.' || curl -s "$BASE_URL/wallets/$WALLET_ID"
echo ""
echo "=========================================="
echo "Summary:"
echo "  Wallet ID: $WALLET_ID"
echo "  Total requests sent: ~900"
echo "  Check KurrentDB: http://localhost:2113"
echo "  Check Elasticsearch: http://localhost:9200/wallets/_search"
echo "=========================================="
echo ""
echo "💡 Tips:"
echo "  - Try larger tests: ./spam-credit.sh $WALLET_ID 1000 10"
echo "  - Advanced test: node load-test.js --wallet $WALLET_ID --requests 5000"
echo "  - View this wallet: curl $BASE_URL/wallets/$WALLET_ID"
echo "=========================================="

