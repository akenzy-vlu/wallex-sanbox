# 🚀 Quick Start Guide

Get up and running with the wallet system and load testing in 5 minutes!

---

## ⚡ 1. Start the Application

```bash
# Build
npm run build

# Start with PM2
pm2 start dist/src/main.js --name wallex

# Check status
pm2 status
pm2 logs wallex
```

---

## ✅ 2. Verify Everything Works

```bash
# Run automated verification
./scripts/verify-ledger-fix.sh
```

**Expected output**: ✅ Success with ledger entries created

---

## 🎯 3. Run Load Tests

### Quick Test (30 seconds)

```bash
cd scripts
python quick_load_test.py --wallets 10 --operations 20
```

### Standard Test (2 minutes)

```bash
python quick_load_test.py --wallets 100 --operations 200 --fast
```

### Stress Test (5 minutes)

```bash
python quick_load_test.py --wallets 500 --operations 1000 --fast --workers 20
```

---

## 📊 4. Check Results

### Check Projectors

```bash
pm2 logs wallex | grep "Ledger entry created"
pm2 logs wallex | grep "Successfully processed"
```

### Check Database

```bash
# Open PostgreSQL
psql -d wallex

# In psql, run:
SELECT COUNT(*) FROM wallets;
SELECT COUNT(*) FROM ledger_entries;
SELECT consumer_name, COUNT(*) FROM outbox_consumer_processing GROUP BY consumer_name;
```

### Check API

```bash
# Get all wallets
curl http://localhost:3000/wallets | jq .

# Get specific wallet ledger
curl http://localhost:3000/ledger/wallet/wallet-123456789 | jq .
```

---

## 🎨 5. Create Your Own Wallets

### Create Wallet

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-test-$(date +%s)" \
  -d '{
    "walletId": "my-wallet-001",
    "ownerId": "user-001",
    "initialBalance": 1000.00
  }'
```

### Credit Wallet

```bash
curl -X POST http://localhost:3000/wallets/my-wallet-001/credit \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: credit-$(date +%s)" \
  -d '{
    "amount": 500.00,
    "description": "Bonus payment"
  }'
```

### Debit Wallet

```bash
curl -X POST http://localhost:3000/wallets/my-wallet-001/debit \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: debit-$(date +%s)" \
  -d '{
    "amount": 200.00,
    "description": "Purchase"
  }'
```

### Transfer Between Wallets

```bash
curl -X POST http://localhost:3000/wallets/my-wallet-001/transfer \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: transfer-$(date +%s)" \
  -d '{
    "toWalletId": "my-wallet-002",
    "amount": 100.00,
    "description": "Payment"
  }'
```

### Check Ledger

```bash
curl http://localhost:3000/ledger/wallet/my-wallet-001 | jq .
```

---

## 🔧 Troubleshooting

### Application Not Starting

```bash
pm2 logs wallex --err
pm2 restart wallex
```

### Ledger Entries Not Created

```bash
# Check projectors are running
pm2 logs wallex | grep "Starting projector"

# Check for errors
pm2 logs wallex | grep -i error

# Run diagnostic
./scripts/verify-ledger-fix.sh
```

### Load Test Failing

```bash
# Check app is running
pm2 status wallex

# Try smaller test
python scripts/quick_load_test.py --wallets 5 --operations 10

# Check for errors
pm2 logs wallex --err | tail -20
```

---

## 📚 Documentation

- **Complete Guide**: `COMPLETE-IMPLEMENTATION-SUMMARY.md`
- **Load Testing**: `LOAD-TESTING-SCRIPTS.md`
- **Troubleshooting**: `LEDGER-TROUBLESHOOTING.md`
- **Architecture**: `LEDGER-FLOW-FIX-SUMMARY.md`
- **Scripts Guide**: `scripts/README.md`

---

## 🎯 Common Commands

```bash
# Application
pm2 start dist/src/main.js --name wallex
pm2 restart wallex
pm2 logs wallex
pm2 stop wallex

# Verification
./scripts/verify-ledger-fix.sh

# Load Testing
python scripts/quick_load_test.py --wallets 10 --operations 20
python scripts/quick_load_test.py --wallets 100 --operations 200 --fast

# Database
psql -d wallex -c "SELECT COUNT(*) FROM wallets;"
psql -d wallex -c "SELECT COUNT(*) FROM ledger_entries;"

# API
curl http://localhost:3000/wallets
curl http://localhost:3000/ledger/wallet/WALLET_ID
```

---

## ✅ Success Checklist

- [ ] Application running (pm2 status)
- [ ] No errors in logs (pm2 logs wallex)
- [ ] Projectors started (logs show "Starting projector")
- [ ] Verification script passes (./scripts/verify-ledger-fix.sh)
- [ ] Load test succeeds (python scripts/quick_load_test.py)
- [ ] Wallets created in database
- [ ] Ledger entries created
- [ ] Both projectors processing events

---

**You're ready to go! 🎉**

For detailed information, see the complete documentation files.
