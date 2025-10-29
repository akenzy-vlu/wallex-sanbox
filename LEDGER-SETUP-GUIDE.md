# Ledger Setup Guide

This guide will help you set up and start using the new ledger functionality.

## Architecture

The ledger uses an **event-driven projection pattern**:
- Wallet operations create events in the event store
- Events are projected to the ledger (audit trail)
- No direct coupling between wallet and ledger modules
- Ledger is a derived view that can be rebuilt from events

For detailed architecture information, see `LEDGER-EVENT-DRIVEN-ARCHITECTURE.md`.

## What Was Implemented

✅ **Database Schema**
- Created `ledger_entries` table with all necessary fields
- Added optimized indexes for fast queries
- Migration file: `src/database/migrations/1730000000003-CreateLedgerEntriesTable.ts`

✅ **Ledger Entity**
- Created TypeORM entity at `src/ledger/domain/entities/ledger-entry.entity.ts`
- Supports 4 transaction types: CREDIT, DEBIT, TRANSFER_OUT, TRANSFER_IN
- Includes metadata support for flexible data storage

✅ **Event-Driven Projection**
- `LedgerProjectionService`: Projects wallet events to ledger entries
- Event handlers for each wallet event type
- Automatic balance tracking and calculation
- Fault-tolerant error handling

✅ **Ledger Service**
- Comprehensive service for recording and querying transactions
- Methods for single and batch entry recording
- Transaction history queries with flexible filtering
- Balance summary calculations

✅ **API Endpoints**
- `GET /ledger/wallet/:walletId` - Get wallet transaction history
- `GET /ledger/wallet/:walletId/summary` - Get wallet balance summary
- `GET /ledger/reference/:referenceId` - Get transactions by reference ID
- `GET /ledger/transactions` - Get all transactions with filters

✅ **Integration with Wallet Operations**
- Wallet handlers project events to ledger after committing
- Create Wallet: Projects WalletCreated event → CREDIT entry
- Credit Wallet: Projects WalletCredited event → CREDIT entry
- Debit Wallet: Projects WalletDebited event → DEBIT entry
- Transfer Wallet: Projects both events → TRANSFER_OUT and TRANSFER_IN entries

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

This will install the new `uuid` package that was added to dependencies.

### 2. Run Database Migration

```bash
npm run migration:run
```

This creates the `ledger_entries` table in your PostgreSQL database.

### 3. Restart the Application

```bash
npm run start:dev
```

The application will now automatically record all transactions to the ledger.

## Verification Steps

### Step 1: Create a Wallet with Initial Balance

```bash
curl -X POST http://localhost:3000/wallet \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "test-wallet-1",
    "ownerId": "user-123",
    "initialBalance": 100
  }'
```

### Step 2: Check Ledger Entry

```bash
curl http://localhost:3000/ledger/wallet/test-wallet-1
```

You should see a CREDIT entry for the initial balance.

### Step 3: Credit the Wallet

```bash
curl -X POST http://localhost:3000/wallet/test-wallet-1/credit \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 50,
    "description": "Test credit"
  }'
```

### Step 4: Check Updated Ledger

```bash
curl http://localhost:3000/ledger/wallet/test-wallet-1
```

You should now see 2 entries (initial balance + credit).

### Step 5: Perform a Transfer

```bash
# First create a second wallet
curl -X POST http://localhost:3000/wallet \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "test-wallet-2",
    "ownerId": "user-456",
    "initialBalance": 50
  }'

# Then transfer between wallets
curl -X POST http://localhost:3000/wallet/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "fromWalletId": "test-wallet-1",
    "toWalletId": "test-wallet-2",
    "amount": 25,
    "description": "Test transfer"
  }'
```

### Step 6: Check Transfer Ledger Entries

```bash
# Check source wallet
curl http://localhost:3000/ledger/wallet/test-wallet-1

# Check destination wallet
curl http://localhost:3000/ledger/wallet/test-wallet-2

# Get wallet summaries
curl http://localhost:3000/ledger/wallet/test-wallet-1/summary
curl http://localhost:3000/ledger/wallet/test-wallet-2/summary
```

## API Examples

### Get Transaction History with Filters

```bash
# Get only CREDIT transactions
curl "http://localhost:3000/ledger/wallet/test-wallet-1?transactionType=CREDIT"

# Get transactions from a date range
curl "http://localhost:3000/ledger/wallet/test-wallet-1?startDate=2025-10-01&endDate=2025-10-31"

# Get paginated results
curl "http://localhost:3000/ledger/wallet/test-wallet-1?limit=10&offset=0"
```

### Get Wallet Balance Summary

```bash
curl http://localhost:3000/ledger/wallet/test-wallet-1/summary
```

Response:
```json
{
  "walletId": "test-wallet-1",
  "totalCredits": 150.00,
  "totalDebits": 25.00,
  "transactionCount": 3,
  "lastTransaction": {
    "id": "uuid",
    "transactionType": "TRANSFER_OUT",
    "amount": "25.00",
    "createdAt": "2025-10-29T10:30:00.000Z"
  }
}
```

### Find Related Transfer Transactions

When you perform a transfer, both ledger entries share a `referenceId`. You can find both sides of the transfer:

```bash
# Get the referenceId from one of the transfer entries
curl http://localhost:3000/ledger/wallet/test-wallet-1

# Then query by that referenceId
curl http://localhost:3000/ledger/reference/{referenceId}
```

This returns both the TRANSFER_OUT and TRANSFER_IN entries.

## Database Queries

You can also query the ledger directly in PostgreSQL:

```sql
-- Get all transactions for a wallet
SELECT * FROM ledger_entries 
WHERE "walletId" = 'test-wallet-1' 
ORDER BY "createdAt" DESC;

-- Get balance summary for a wallet
SELECT 
  "walletId",
  SUM(CASE WHEN "transactionType" IN ('CREDIT', 'TRANSFER_IN') THEN amount ELSE 0 END) as total_credits,
  SUM(CASE WHEN "transactionType" IN ('DEBIT', 'TRANSFER_OUT') THEN amount ELSE 0 END) as total_debits,
  COUNT(*) as transaction_count
FROM ledger_entries
WHERE "walletId" = 'test-wallet-1'
GROUP BY "walletId";

-- Find related transfer transactions
SELECT * FROM ledger_entries 
WHERE "referenceId" = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY "createdAt";

-- Get all transfers between two specific wallets
SELECT * FROM ledger_entries 
WHERE "walletId" = 'wallet-a' AND "relatedWalletId" = 'wallet-b'
   OR "walletId" = 'wallet-b' AND "relatedWalletId" = 'wallet-a'
ORDER BY "createdAt" DESC;
```

## Troubleshooting

### Issue: Migration fails with "relation already exists"

**Solution**: The table might already exist. Check with:
```sql
SELECT * FROM pg_tables WHERE tablename = 'ledger_entries';
```

If it exists, skip the migration or drop and recreate:
```sql
DROP TABLE IF EXISTS ledger_entries CASCADE;
```
Then run the migration again.

### Issue: Ledger entries not being created

**Solution**: Check the application logs for errors. The ledger service logs all operations:
```
[LedgerService] Recording ledger entry for wallet user-123: CREDIT 100
[LedgerService] Ledger entry created: uuid for wallet user-123
```

### Issue: TypeScript errors about uuid

**Solution**: Make sure you've installed dependencies:
```bash
npm install
# or
yarn install
```

## Performance Considerations

### Indexes
The ledger table has the following indexes for optimal performance:
- `walletId` - For wallet-specific queries
- `(walletId, createdAt)` - For time-ordered transaction history
- `(transactionType, createdAt)` - For filtering by type
- `referenceId` - For finding related transactions

### Query Optimization
- Use the `limit` parameter to avoid loading too many records
- Use date ranges to narrow down queries
- Consider caching frequently accessed summaries

### Scaling
For high-volume applications, consider:
- Partitioning the table by date (monthly or yearly)
- Using read replicas for heavy query loads
- Archiving old entries to cold storage

## Next Steps

1. **Test the endpoints** using the verification steps above
2. **Review the documentation** in `LEDGER-IMPLEMENTATION.md`
3. **Monitor performance** in production
4. **Consider enhancements** like reporting and analytics

## Support

For questions or issues:
1. Check the main documentation in `LEDGER-IMPLEMENTATION.md`
2. Review the code in `src/ledger/`
3. Check the integration in wallet handlers at `src/wallet/application/commands/handlers/`

## File Reference

### Created Files
- `src/ledger/domain/entities/ledger-entry.entity.ts` - Entity definition
- `src/database/migrations/1730000000003-CreateLedgerEntriesTable.ts` - Migration
- `src/ledger/application/ledger-projection.service.ts` - Event projection service
- `src/ledger/application/event-handlers/wallet-created.handler.ts` - WalletCreated event handler
- `src/ledger/application/event-handlers/wallet-credited.handler.ts` - WalletCredited event handler
- `src/ledger/application/event-handlers/wallet-debited.handler.ts` - WalletDebited event handler
- `LEDGER-IMPLEMENTATION.md` - Detailed implementation guide
- `LEDGER-EVENT-DRIVEN-ARCHITECTURE.md` - Architecture documentation
- `LEDGER-SETUP-GUIDE.md` - This file

### Modified Files
- `src/database/data-source.ts` - Added LedgerEntryEntity
- `src/ledger/application/ledger.service.ts` - Implemented service methods
- `src/ledger/ledger.module.ts` - Added event handlers and projection service
- `src/ledger/interfaces/rest/ledger.controller.ts` - Added API endpoints
- `src/wallet/wallet.module.ts` - Imported LedgerModule
- `src/wallet/application/commands/handlers/create-wallet.handler.ts` - Added event projection
- `src/wallet/application/commands/handlers/credit-wallet.handler.ts` - Added event projection
- `src/wallet/application/commands/handlers/debit-wallet.handler.ts` - Added event projection
- `src/wallet/application/commands/handlers/transfer-wallet.handler.ts` - Added event projection
- `package.json` - Added uuid dependencies

