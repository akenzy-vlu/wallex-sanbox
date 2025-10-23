# Load Testing Scripts

This directory contains scripts for load testing the wallet API, specifically for testing credit and debit operations under high load.

## Scripts Overview

### 1. `setup-test-wallet.sh`
Creates a test wallet with a high initial balance for load testing.

**Usage:**
```bash
./setup-test-wallet.sh [walletId] [initialBalance] [ownerId]
```

**Example:**
```bash
./setup-test-wallet.sh test-wallet 100000 test-user
```

### 2. `spam-credit.sh`
Sends multiple credit requests to a wallet in parallel.

**Usage:**
```bash
./spam-credit.sh <walletId> <numberOfRequests> [amount] [baseUrl]
```

**Example:**
```bash
./spam-credit.sh test-wallet 1000 10
```

This will send 1000 credit requests, each adding 10 to the wallet balance.

### 3. `spam-debit.sh`
Sends multiple debit requests to a wallet in parallel.

**Usage:**
```bash
./spam-debit.sh <walletId> <numberOfRequests> [amount] [baseUrl]
```

**Example:**
```bash
./spam-debit.sh test-wallet 1000 5
```

This will send 1000 debit requests, each subtracting 5 from the wallet balance.

### 4. `mixed-load-test.sh`
Runs a mixed load test with both credit and debit operations.

**Usage:**
```bash
./mixed-load-test.sh <walletId> <numberOfRequests> [creditAmount] [debitAmount] [baseUrl]
```

**Example:**
```bash
./mixed-load-test.sh test-wallet 1000 20 10
```

This alternates between credit and debit operations.

### 5. `load-test.js` (Advanced)
Node.js-based load testing script with detailed statistics and better control.

**Usage:**
```bash
node load-test.js [options]
```

**Options:**
- `--wallet <id>` - Wallet ID to test (default: test-wallet)
- `--requests <number>` - Total number of requests (default: 1000)
- `--concurrent <number>` - Concurrent requests (default: 50)
- `--credit <amount>` - Credit amount per request (default: 20)
- `--debit <amount>` - Debit amount per request (default: 10)
- `--type <credit|debit|mixed>` - Type of test (default: mixed)
- `--url <url>` - Base URL (default: http://localhost:3000)

**Examples:**
```bash
# Run 1000 mixed requests
node load-test.js --wallet test-wallet --requests 1000 --type mixed

# Run 5000 credit-only requests with 100 concurrent
node load-test.js --wallet test-wallet --requests 5000 --type credit --concurrent 100

# Run 2000 debit-only requests
node load-test.js --wallet test-wallet --requests 2000 --type debit --debit 5
```

## Quick Start

### Setup
1. Make scripts executable:
```bash
chmod +x scripts/*.sh
```

2. Ensure your application is running:
```bash
yarn start:dev
```

3. Ensure infrastructure is running:
```bash
docker-compose up -d
```

### Run Complete Test

**1. Create test wallet:**
```bash
cd scripts
./setup-test-wallet.sh my-test-wallet 100000
```

**2. Run credit spam test:**
```bash
./spam-credit.sh my-test-wallet 1000 10
```

**3. Run debit spam test:**
```bash
./spam-debit.sh my-test-wallet 1000 5
```

**4. Run mixed load test:**
```bash
./mixed-load-test.sh my-test-wallet 1000 20 10
```

**5. Or use the advanced Node.js script:**
```bash
node load-test.js --wallet my-test-wallet --requests 1000 --concurrent 50 --type mixed
```

## Test Scenarios

### Scenario 1: Basic Load Test (1000 requests)
```bash
./setup-test-wallet.sh load-test-1 50000
node load-test.js --wallet load-test-1 --requests 1000 --type mixed
```

### Scenario 2: High Concurrency Test
```bash
./setup-test-wallet.sh load-test-2 100000
node load-test.js --wallet load-test-2 --requests 5000 --concurrent 200 --type mixed
```

### Scenario 3: Credit-Only Stress Test
```bash
./setup-test-wallet.sh load-test-3 0
node load-test.js --wallet load-test-3 --requests 10000 --type credit --concurrent 100
```

### Scenario 4: Debit Stress Test (Testing Insufficient Funds)
```bash
./setup-test-wallet.sh load-test-4 1000
node load-test.js --wallet load-test-4 --requests 5000 --type debit --debit 1 --concurrent 100
```

## Expected Results

### Successful Test
- All or most requests should succeed (200 OK)
- Final balance should match expected calculation
- No critical errors in the application logs
- Events properly stored in KurrentDB
- Read model updated in Elasticsearch

### Performance Metrics
The scripts will show:
- **Success/Failure counts** - Track successful vs failed operations
- **Response times** - Min, max, avg, median, p95, p99
- **Requests per second** - Overall throughput
- **Balance verification** - Compare expected vs actual balance changes
- **Version tracking** - Number of events created

## Troubleshooting

### High Failure Rate
- Check if the wallet has sufficient balance for debit operations
- Verify the application is running and responding
- Check system resources (CPU, memory, database connections)
- Reduce concurrent requests with `--concurrent` option

### Slow Performance
- Check KurrentDB and Elasticsearch performance
- Monitor database connection pool
- Check network latency
- Increase system resources

### Balance Mismatch
- May indicate concurrency issues or event projection delays
- Check KurrentDB event stream for the wallet
- Verify Elasticsearch projection is running
- Check application logs for errors

## Monitoring During Tests

### 1. Check Application Logs
```bash
# Watch application output
yarn start:dev
```

### 2. Monitor KurrentDB
```bash
# Visit KurrentDB UI
open http://localhost:2113
```

### 3. Check Elasticsearch
```bash
# Query wallet state
curl http://localhost:9200/wallets/_search?pretty

# Get specific wallet
curl http://localhost:9200/wallets/_doc/<wallet-id>?pretty
```

### 4. Monitor System Resources
```bash
# macOS
top

# or
htop

# Docker stats
docker stats
```

## Notes

- Scripts use `curl` for HTTP requests (bash scripts) or native Node.js http module
- Bash scripts create concurrent requests using background processes (`&`)
- The Node.js script provides better concurrency control and statistics
- All scripts support custom base URLs for testing different environments
- Response times are measured for performance analysis

## Safety Considerations

⚠️ **Warning**: These are load testing scripts that can generate high load on your system.

- Start with small numbers (100-500 requests) and gradually increase
- Monitor system resources during tests
- Use dedicated test wallets, not production data
- Ensure proper infrastructure resources (RAM, CPU, disk space)
- KurrentDB and Elasticsearch should have adequate resources

## Advanced Usage

### Custom Base URL
```bash
# Test against different environment
./spam-credit.sh test-wallet 1000 10 http://staging.example.com:3000
```

### Chaining Tests
```bash
#!/bin/bash
# Create and run complete test suite

WALLET_ID="stress-test-wallet"

./setup-test-wallet.sh $WALLET_ID 100000

echo "Running credit test..."
./spam-credit.sh $WALLET_ID 500 10

echo "Running debit test..."
./spam-debit.sh $WALLET_ID 500 5

echo "Running mixed test..."
./mixed-load-test.sh $WALLET_ID 1000 15 8

echo "All tests completed!"
```

### Continuous Load Testing
```bash
# Run continuous tests in a loop
for i in {1..10}; do
  echo "=== Test Iteration $i ==="
  node load-test.js --wallet test-wallet --requests 500 --type mixed
  sleep 5
done
```

## Integration with CI/CD

You can integrate these scripts into your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Setup Test Environment
  run: |
    docker-compose up -d
    yarn install
    yarn start:dev &
    
- name: Wait for API
  run: sleep 10

- name: Run Load Tests
  run: |
    cd scripts
    chmod +x *.sh
    ./setup-test-wallet.sh ci-test-wallet 100000
    node load-test.js --wallet ci-test-wallet --requests 1000
```

## Support

For issues or questions about load testing:
1. Check application logs for errors
2. Verify infrastructure is healthy (KurrentDB, Elasticsearch)
3. Review [Main README](../README.md) for API documentation
4. Check [Transfer API Guide](../TRANSFER_API_GUIDE.md) for additional info

