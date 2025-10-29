# Wallet Load Testing Scripts

Python scripts to create multiple wallets and perform random credit, debit, and transfer operations for testing the wallet system.

## Setup

### 1. Install Python Dependencies

```bash
cd scripts
pip install -r requirements.txt
```

Or using pip3:
```bash
pip3 install -r requirements.txt
```

### 2. Ensure Application is Running

Make sure the wallet application is running:
```bash
pm2 status wallex
```

If not running:
```bash
pm2 start dist/src/main.js --name wallex
```

## Available Scripts

### 1. `quick_load_test.py` - Fast and Configurable (RECOMMENDED)

Quick load testing with configurable parameters and optional parallel execution.

#### Basic Usage

```bash
# Create 100 wallets and perform 200 operations (sequential)
python quick_load_test.py

# Custom configuration
python quick_load_test.py --wallets 50 --operations 100

# Fast mode with parallel execution
python quick_load_test.py --wallets 100 --operations 500 --fast

# Fast mode with custom worker count
python quick_load_test.py --wallets 200 --operations 1000 --fast --workers 20
```

#### Options

- `--wallets`: Number of wallets to create (default: 100)
- `--operations`: Number of random operations to perform (default: 200)
- `--fast`: Enable parallel execution for faster testing
- `--workers`: Number of parallel workers (default: 10, only with --fast)

#### Examples

```bash
# Small test (quick)
python quick_load_test.py --wallets 10 --operations 20

# Medium test
python quick_load_test.py --wallets 100 --operations 200 --fast

# Large test
python quick_load_test.py --wallets 500 --operations 2000 --fast --workers 20

# Stress test
python quick_load_test.py --wallets 1000 --operations 5000 --fast --workers 30
```

### 2. `load_test_wallets.py` - Detailed with Progress Bars

Comprehensive load testing with detailed progress bars and verification.

#### Usage

```bash
python load_test_wallets.py
```

This script:
- Creates 100 wallets with random initial balances (100-10,000)
- Waits for async processing
- Performs 200 random operations:
  - Credits (10-1,000 random amount)
  - Debits (10-500, max 50% of balance)
  - Transfers (10-300, max 30% of balance)
- Verifies ledger entries for sample wallets
- Shows detailed statistics

#### Configuration

Edit the script to change defaults:
```python
NUM_WALLETS = 100       # Number of wallets
NUM_OPERATIONS = 200    # Number of operations
SLEEP_BETWEEN_OPS = 0.1 # Delay between ops (seconds)
```

## Output Examples

### Quick Load Test Output

```
======================================================================
🚀 Quick Wallet Load Test
======================================================================

⚙️  Configuration:
   Wallets: 100
   Operations: 200
   Mode: Parallel
   Workers: 10

📝 Creating 100 wallets...
   Progress: 100/100 (98 ✓, 2 ✗)
✅ Created 98 wallets in 12.45s

⏳ Waiting 5 seconds for async processing...

🎲 Performing 200 random operations...
   Progress: 200/200 (195 ✓)
✅ Completed operations in 8.23s

🔍 Checking ledger entries (sample)...
   wallet-1761721...: 15 entries
   wallet-1761722...: 8 entries
   wallet-1761723...: 12 entries

======================================================================
📊 Final Statistics
======================================================================

💼 Wallets:
   ✅ Success: 98
   ❌ Failed:  2

💰 Operations:
   Credit:   67 ✓ / 1 ✗
   Debit:    63 ✓ / 2 ✗
   Transfer: 65 ✓ / 2 ✗

   Total: 195 ✓ / 5 ✗

⏱️  Total Duration: 20.68s
   Operations/sec: 23.70

======================================================================
✅ Load test complete!
======================================================================
```

## Verification

### Check Application Logs

```bash
# Check for errors
pm2 logs wallex --err

# Check projector activity
pm2 logs wallex | grep -E "(ledger-projector|read-model-projector)"

# Check successful operations
pm2 logs wallex | grep "Successfully processed"
```

### Check Database

```sql
-- Count wallets
SELECT COUNT(*) FROM wallets;

-- Count ledger entries
SELECT COUNT(*) FROM ledger_entries;

-- Count outbox events
SELECT COUNT(*) FROM outbox;

-- Check consumer processing
SELECT 
  consumer_name,
  COUNT(*) as events_processed
FROM outbox_consumer_processing
GROUP BY consumer_name;
```

### API Verification

```bash
# Get a wallet
curl http://localhost:3000/wallets/wallet-1234567890

# Get ledger entries
curl http://localhost:3000/ledger/wallet/wallet-1234567890

# Get all wallets (paginated)
curl http://localhost:3000/wallets
```

## Troubleshooting

### Connection Refused

```
Error: Connection refused
```

**Solution**: Make sure the application is running:
```bash
pm2 restart wallex
pm2 logs wallex
```

### Timeout Errors

```
Error: Timeout
```

**Solution**: Reduce parallel workers or add delays:
```bash
python quick_load_test.py --wallets 50 --operations 100 --workers 5
```

### Insufficient Funds

```
Error: Insufficient funds
```

This is expected for some debit/transfer operations. The scripts handle this gracefully.

### High Failure Rate

If many operations are failing:
1. Check application logs: `pm2 logs wallex --err`
2. Verify database connection
3. Check if projectors are running
4. Reduce load: use fewer workers or slower execution

## Performance Tips

### For Best Performance

1. **Use fast mode** for creating many wallets:
   ```bash
   python quick_load_test.py --wallets 500 --fast --workers 20
   ```

2. **Monitor system resources**:
   ```bash
   # CPU and memory
   top
   
   # Database connections
   SELECT count(*) FROM pg_stat_activity;
   ```

3. **Adjust workers** based on your system:
   - CPU cores available: `nproc` or `sysctl -n hw.ncpu`
   - Recommended: 10-20 workers for good balance
   - High-end: 30-50 workers for stress testing

4. **Sequential for debugging**:
   ```bash
   python quick_load_test.py --wallets 10 --operations 20
   ```

## Advanced Usage

### Custom Test Scenarios

Edit `quick_load_test.py` to customize operation weights:

```python
# In perform_operation function, adjust probabilities
operations = ["credit"] * 5 + ["debit"] * 3 + ["transfer"] * 2
# This gives: 50% credit, 30% debit, 20% transfer
```

### Continuous Load

Run continuous load test:

```bash
while true; do
  python quick_load_test.py --wallets 10 --operations 50 --fast
  sleep 10
done
```

### Stress Test

Maximum stress test:

```bash
python quick_load_test.py \
  --wallets 2000 \
  --operations 10000 \
  --fast \
  --workers 50
```

## Cleanup

After testing, you may want to clean up test data:

```sql
-- Delete test wallets (be careful!)
DELETE FROM wallets WHERE id LIKE 'wallet-%';
DELETE FROM ledger_entries WHERE wallet_id LIKE 'wallet-%';
DELETE FROM outbox WHERE aggregate_id LIKE 'wallet-%';
DELETE FROM outbox_consumer_processing WHERE outbox_event_id NOT IN (SELECT id FROM outbox);
```

Or use a safer approach - delete only old test data:

```sql
-- Delete wallets older than 1 hour
DELETE FROM wallets 
WHERE id LIKE 'wallet-%' 
  AND created_at < NOW() - INTERVAL '1 hour';
```

## Support

For issues or questions:
1. Check application logs: `pm2 logs wallex`
2. Review the troubleshooting guide: `LEDGER-TROUBLESHOOTING.md`
3. Verify the ledger flow: `./verify-ledger-fix.sh`
