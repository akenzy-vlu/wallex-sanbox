# Wallet Persistence Layer Integration

## Overview
This document describes the integration of the persistence layer (PostgreSQL/TypeORM) with the event sourcing system for wallet operations.

## Problem
Previously, wallet operations were only:
1. ✅ Appending events to the event store (KurrentDB)
2. ✅ Projecting events to the read model (Elasticsearch)
3. ❌ **NOT** updating the persistence layer (PostgreSQL WalletEntity)

This meant that the PostgreSQL database was not being kept in sync with the event store and read model.

## Solution
Integrated the `WalletRepository` into all command handlers to ensure that wallet operations update all three data stores:
1. Event Store (source of truth)
2. Persistence Layer (PostgreSQL for transactions and holds)
3. Read Model (Elasticsearch for queries)

## Changes Made

### 1. Create Wallet Handler
**File**: `src/wallet/application/commands/handlers/create-wallet.handler.ts`

**Changes**:
- Added `WalletRepository` dependency injection
- Added check for existing wallet in persistence layer
- Added `walletRepository.create()` call after appending events
- Added error handling and logging

**Flow**:
```
1. Acquire distributed lock
2. Check if wallet exists in event store
3. Check if wallet exists in persistence layer
4. Create aggregate and generate events
5. Append events to event store
6. Create wallet in persistence layer ✨ NEW
7. Project events to read model
8. Return wallet snapshot
```

### 2. Credit Wallet Handler
**File**: `src/wallet/application/commands/handlers/credit-wallet.handler.ts`

**Changes**:
- Added `WalletRepository` dependency injection
- Added `walletRepository.credit()` call after appending events
- Added error handling and logging
- Replaced `console.log` with proper logger

**Flow**:
```
1. Acquire distributed lock
2. Load aggregate from snapshot
3. Apply credit operation
4. Append events to event store
5. Update persistence layer (credit) ✨ NEW
6. Project events to read model
7. Create snapshot if needed
8. Return wallet snapshot
```

### 3. Debit Wallet Handler
**File**: `src/wallet/application/commands/handlers/debit-wallet.handler.ts`

**Changes**:
- Added `WalletRepository` dependency injection
- Added `walletRepository.debit()` call after appending events
- Added error handling and logging

**Flow**:
```
1. Acquire distributed lock
2. Load aggregate from snapshot
3. Apply debit operation
4. Append events to event store
5. Update persistence layer (debit) ✨ NEW
6. Project events to read model
7. Create snapshot if needed
8. Return wallet snapshot
```

### 4. Transfer Wallet Handler
**File**: `src/wallet/application/commands/handlers/transfer-wallet.handler.ts`

**Changes**:
- Added `WalletRepository` dependency injection
- Added `walletRepository.transfer()` call after appending events
- Added error handling and logging

**Flow**:
```
1. Acquire distributed locks (both wallets, ordered)
2. Load both aggregates from snapshots
3. Apply debit to source wallet
4. Apply credit to destination wallet
5. Append events to event store (both wallets)
6. Execute transfer in persistence layer (transactional) ✨ NEW
7. Project events to read model
8. Create snapshots if needed
9. Return both wallet snapshots
```

## Benefits

### 1. Data Consistency
All three data stores are now kept in sync:
- Event Store (KurrentDB) - source of truth
- Persistence Layer (PostgreSQL) - for transactional operations
- Read Model (Elasticsearch) - for fast queries

### 2. Transaction Support
The persistence layer provides:
- Pessimistic locking for concurrent operations
- ACID transactions for transfers
- Support for holds and reserved balances

### 3. Error Handling
Proper error handling ensures:
- Failed persistence operations are logged
- Errors propagate correctly
- Event store remains source of truth

### 4. Performance
- Snapshot optimization reduces event replay
- Distributed locking prevents concurrent modifications
- PostgreSQL provides efficient queries for holds

## Architecture

```
┌─────────────────┐
│  Command Bus    │
└────────┬────────┘
         │
         v
┌─────────────────────────────────┐
│   Command Handler               │
│  (Create/Credit/Debit/Transfer) │
└────┬──────────┬─────────────┬───┘
     │          │             │
     v          v             v
┌────────┐ ┌────────┐  ┌──────────┐
│ Event  │ │ Wallet │  │ Wallet   │
│ Store  │ │ Repo   │  │ Read     │
│(Source)│ │(RDBMS) │  │ Model    │
└────────┘ └────────┘  └──────────┘
```

## Testing

To test the integration, ensure:
1. PostgreSQL database is running
2. TypeORM migrations are executed
3. Create, credit, debit, and transfer operations succeed
4. All three data stores contain consistent data
5. Error scenarios are handled gracefully

## Migration Notes

### Existing Wallets
If you have existing wallets in the event store but not in PostgreSQL:
1. Run a migration script to replay events and populate PostgreSQL
2. Or: Clear all data and start fresh with the integrated system

### Environment Setup
Ensure these services are running:
- PostgreSQL (for persistence layer)
- KurrentDB (for event store)
- Elasticsearch (for read model)
- Redis (for distributed locks)

## Future Improvements

1. **Saga Pattern**: Implement compensation logic if persistence fails after event commit
2. **Outbox Pattern**: Ensure reliable projection of events to read model
3. **Idempotency**: Add idempotency keys to prevent duplicate operations
4. **Monitoring**: Add metrics for persistence layer performance
5. **Replay Tools**: Build tools to rebuild persistence layer from event store

## Related Files

- `src/wallet/infrastructure/persistence/wallet.repository.ts` - Persistence layer implementation
- `src/wallet/domain/entities/wallet.entity.ts` - TypeORM entity definition
- `src/wallet/infrastructure/event-store/event-store.service.ts` - Event store service
- `src/wallet/infrastructure/projections/wallet-projection.service.ts` - Read model projection
- `src/wallet/wallet.module.ts` - Module configuration

