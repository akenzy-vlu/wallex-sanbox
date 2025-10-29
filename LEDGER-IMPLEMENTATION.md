# Ledger Implementation

This document describes the ledger implementation for the Wallex application. The ledger provides a complete audit trail of all financial transactions.

## Overview

The ledger system automatically records all wallet operations:
- **Wallet Creation** with initial balance
- **Credit** transactions
- **Debit** transactions
- **Transfer** transactions (both sides)

## Architecture

### Database Schema

The ledger uses a dedicated `ledger_entries` table with the following structure:

```sql
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY,
  walletId VARCHAR(255) NOT NULL,
  transactionType ENUM('CREDIT', 'DEBIT', 'TRANSFER_OUT', 'TRANSFER_IN'),
  amount DECIMAL(20, 2) NOT NULL,
  balanceBefore DECIMAL(20, 2) NOT NULL,
  balanceAfter DECIMAL(20, 2) NOT NULL,
  description VARCHAR(255),
  referenceId VARCHAR(255),  -- Links related transactions (e.g., transfer pairs)
  relatedWalletId VARCHAR(255),  -- The other wallet in a transfer
  metadata JSONB,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes

The following indexes are created for optimal query performance:
- `walletId` - Single column index
- `(walletId, createdAt)` - Composite index for transaction history queries
- `(transactionType, createdAt)` - For filtering by transaction type
- `referenceId` - For finding related transactions

## Transaction Types

### 1. CREDIT
Direct credit to a wallet (e.g., deposits, refunds, initial balance).

```json
{
  "transactionType": "CREDIT",
  "amount": 100.00,
  "balanceBefore": 50.00,
  "balanceAfter": 150.00,
  "description": "Deposit",
  "metadata": {
    "eventType": "WalletCredited"
  }
}
```

### 2. DEBIT
Direct debit from a wallet (e.g., withdrawals, payments).

```json
{
  "transactionType": "DEBIT",
  "amount": 25.00,
  "balanceBefore": 150.00,
  "balanceAfter": 125.00,
  "description": "Payment",
  "metadata": {
    "eventType": "WalletDebited"
  }
}
```

### 3. TRANSFER_OUT
Outgoing transfer from a wallet.

```json
{
  "transactionType": "TRANSFER_OUT",
  "amount": 50.00,
  "balanceBefore": 125.00,
  "balanceAfter": 75.00,
  "description": "Transfer to wallet B",
  "referenceId": "550e8400-e29b-41d4-a716-446655440000",
  "relatedWalletId": "wallet-b",
  "metadata": {
    "eventType": "WalletDebited",
    "transferType": "outgoing"
  }
}
```

### 4. TRANSFER_IN
Incoming transfer to a wallet.

```json
{
  "transactionType": "TRANSFER_IN",
  "amount": 50.00,
  "balanceBefore": 200.00,
  "balanceAfter": 250.00,
  "description": "Transfer from wallet A",
  "referenceId": "550e8400-e29b-41d4-a716-446655440000",
  "relatedWalletId": "wallet-a",
  "metadata": {
    "eventType": "WalletCredited",
    "transferType": "incoming"
  }
}
```

## API Endpoints

### 1. Get Wallet Transaction History

Get all transactions for a specific wallet.

```bash
GET /ledger/wallet/:walletId
```

**Query Parameters:**
- `transactionType` (optional): Filter by type (CREDIT, DEBIT, TRANSFER_OUT, TRANSFER_IN)
- `startDate` (optional): Start date (ISO 8601 format)
- `endDate` (optional): End date (ISO 8601 format)
- `limit` (optional): Number of records (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Example:**
```bash
curl "http://localhost:3000/ledger/wallet/user-123?transactionType=CREDIT&limit=10"
```

**Response:**
```json
{
  "walletId": "user-123",
  "count": 10,
  "transactions": [
    {
      "id": "uuid",
      "walletId": "user-123",
      "transactionType": "CREDIT",
      "amount": "100.00",
      "balanceBefore": "50.00",
      "balanceAfter": "150.00",
      "description": "Deposit",
      "referenceId": null,
      "relatedWalletId": null,
      "metadata": {},
      "createdAt": "2025-10-29T10:30:00.000Z"
    }
  ]
}
```

### 2. Get Wallet Balance Summary

Get a summary of all transactions for a wallet.

```bash
GET /ledger/wallet/:walletId/summary
```

**Example:**
```bash
curl "http://localhost:3000/ledger/wallet/user-123/summary"
```

**Response:**
```json
{
  "walletId": "user-123",
  "totalCredits": 500.00,
  "totalDebits": 200.00,
  "transactionCount": 25,
  "lastTransaction": {
    "id": "uuid",
    "transactionType": "CREDIT",
    "amount": "100.00",
    "createdAt": "2025-10-29T10:30:00.000Z"
  }
}
```

### 3. Get Transactions by Reference ID

Get all transactions linked by a reference ID (useful for finding both sides of a transfer).

```bash
GET /ledger/reference/:referenceId
```

**Example:**
```bash
curl "http://localhost:3000/ledger/reference/550e8400-e29b-41d4-a716-446655440000"
```

**Response:**
```json
{
  "referenceId": "550e8400-e29b-41d4-a716-446655440000",
  "count": 2,
  "transactions": [
    {
      "id": "uuid-1",
      "walletId": "wallet-a",
      "transactionType": "TRANSFER_OUT",
      "amount": "50.00",
      "relatedWalletId": "wallet-b"
    },
    {
      "id": "uuid-2",
      "walletId": "wallet-b",
      "transactionType": "TRANSFER_IN",
      "amount": "50.00",
      "relatedWalletId": "wallet-a"
    }
  ]
}
```

### 4. Get All Transactions (Admin)

Get all transactions with optional filters.

```bash
GET /ledger/transactions
```

**Query Parameters:**
- `transactionType` (optional)
- `startDate` (optional)
- `endDate` (optional)
- `limit` (optional, default: 50)
- `offset` (optional, default: 0)

## Integration with Wallet Operations

The ledger is automatically integrated with all wallet command handlers:

### Create Wallet Handler
Records a CREDIT entry if the wallet is created with an initial balance > 0.

### Credit Wallet Handler
Records a CREDIT entry for every credit operation.

### Debit Wallet Handler
Records a DEBIT entry for every debit operation.

### Transfer Wallet Handler
Records two entries with a shared `referenceId`:
1. TRANSFER_OUT for the source wallet
2. TRANSFER_IN for the destination wallet

## Running Migrations

To create the ledger table, run the migration:

```bash
npm run migration:run
```

The migration file is located at:
```
src/database/migrations/1730000000003-CreateLedgerEntriesTable.ts
```

## Usage Examples

### Example 1: Create Wallet with Initial Balance

```bash
POST /wallet
{
  "walletId": "user-123",
  "ownerId": "user-123",
  "initialBalance": 100
}
```

This automatically creates a ledger entry:
- Type: CREDIT
- Amount: 100
- Description: "Initial balance"

### Example 2: Credit a Wallet

```bash
POST /wallet/user-123/credit
{
  "amount": 50,
  "description": "Bonus payment"
}
```

This creates a ledger entry:
- Type: CREDIT
- Amount: 50
- Description: "Bonus payment"

### Example 3: Transfer Between Wallets

```bash
POST /wallet/transfer
{
  "fromWalletId": "user-123",
  "toWalletId": "user-456",
  "amount": 25,
  "description": "Payment for services"
}
```

This creates TWO ledger entries with the same `referenceId`:
1. TRANSFER_OUT from user-123
2. TRANSFER_IN to user-456

### Example 4: Query Transaction History

```bash
# Get all transactions for a wallet
GET /ledger/wallet/user-123

# Get only credits
GET /ledger/wallet/user-123?transactionType=CREDIT

# Get transactions in date range
GET /ledger/wallet/user-123?startDate=2025-10-01&endDate=2025-10-31

# Get paginated results
GET /ledger/wallet/user-123?limit=20&offset=40
```

## Benefits

1. **Complete Audit Trail**: Every transaction is recorded with before/after balances
2. **Transfer Tracking**: Related transactions are linked via `referenceId`
3. **Fast Queries**: Optimized indexes for common query patterns
4. **Metadata Support**: Flexible JSONB field for additional context
5. **Immutable Records**: Ledger entries are never modified or deleted
6. **Reconciliation**: Easy to verify wallet balances match ledger records

## Technical Notes

### Consistency
- Ledger entries are created AFTER the wallet state is successfully persisted
- If ledger creation fails, the error is logged but the wallet operation succeeds
- The event store remains the source of truth

### Performance
- Ledger writes are asynchronous and don't block wallet operations
- Indexes ensure fast queries even with millions of records
- Consider archiving old ledger entries for long-term storage

### Scalability
- The ledger table can be partitioned by date for better performance
- Read replicas can be used for heavy query loads
- Consider using TimescaleDB for time-series optimization

## Future Enhancements

Potential improvements to consider:

1. **Ledger Reconciliation Service**: Automated job to verify wallet balances match ledger
2. **Reporting API**: Generate financial reports (daily summaries, balance sheets)
3. **Export API**: Export ledger data in various formats (CSV, Excel)
4. **Real-time Notifications**: WebSocket updates for ledger entries
5. **Archival Strategy**: Move old entries to cold storage
6. **Analytics**: Aggregate statistics and trends

