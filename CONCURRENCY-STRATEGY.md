# Concurrency Control Strategy

## Overview
This document explains how concurrent wallet operations are handled to prevent race conditions and ensure data consistency.

## Problem Fixed

### Error Encountered
```
PessimisticLockTransactionRequiredError: An open transaction is required for pessimistic lock.
```

This error occurred when trying to credit/debit wallets because the repository was using pessimistic database locks without an active transaction.

### Root Cause
The `WalletRepository` methods (`credit`, `debit`) were using:
```typescript
const wallet = await repo.findOne({
  where: { id: walletId },
  lock: { mode: 'pessimistic_write' }, // ❌ Requires active transaction
});
```

But TypeORM's pessimistic locking requires an open database transaction, which wasn't being provided.

## Solution: Distributed Locking

### Why We Use Distributed Locks (Redis)

Instead of database-level pessimistic locks, we use **distributed locks via Redis** at the command handler level. This is a better approach because:

1. **Already Implemented**: All command handlers use `DistributedLockService`
2. **Works Across Services**: Locks work even in a distributed/microservices environment
3. **Prevents Redundancy**: No need for both Redis locks AND database locks
4. **Simpler Code**: No need to wrap every operation in database transactions
5. **Better Performance**: Redis locks are faster than database locks

### Implementation

#### Handler Level (Redis Distributed Lock)
```typescript
// In credit-wallet.handler.ts
return this.lockService.withLock(
  `lock:wallet:${command.walletId}`,
  5000, // 5 seconds TTL
  async () => {
    // All wallet operations happen here
    // Only ONE handler can execute this block at a time for this walletId
    
    // 1. Load aggregate
    const result = await this.snapshotService.loadAggregate(command.walletId);
    
    // 2. Apply domain logic
    aggregate.credit(command.amount, command.description);
    
    // 3. Append to event store
    await this.eventStore.appendToStream(...);
    
    // 4. Update persistence layer
    await this.walletRepository.credit(command.walletId, command.amount);
    
    // 5. Project to read model
    await this.projection.project(committedEvents);
  }
);
```

#### Repository Level (No Locks Needed)
```typescript
// In wallet.repository.ts
async credit(walletId: string, amount: number): Promise<WalletEntity> {
  // No lock needed - already protected by distributed lock at handler level
  const wallet = await repo.findOne({ where: { id: walletId } });
  
  wallet.balance += amount;
  wallet.availableBalance = wallet.calculateAvailableBalance();
  
  return await repo.save(wallet);
}
```

## Concurrency Architecture

```
┌─────────────────────────────────────────────────┐
│         Command Handler (Credit/Debit)         │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  Distributed Lock (Redis)                 │ │
│  │  Key: lock:wallet:{walletId}              │ │
│  │  TTL: 5 seconds                           │ │
│  │                                           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 1. Load Aggregate (Event Store)     │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 2. Apply Domain Logic (Aggregate)   │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 3. Append Events (Event Store)      │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 4. Update Persistence (PostgreSQL)  │ │ │
│  │  │    - No pessimistic lock            │ │ │
│  │  │    - Protected by Redis lock above  │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                           │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ 5. Project to Read Model (ES)       │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  │                                           │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Lock Ordering for Transfers

For wallet transfers (which involve TWO wallets), we use **consistent lock ordering** to prevent deadlocks:

```typescript
// In transfer-wallet.handler.ts
const [firstWalletId, secondWalletId] = [fromWalletId, toWalletId].sort();

// Always acquire locks in alphabetical order
return this.lockService.withLock(`lock:wallet:${firstWalletId}`, 5000, async () => {
  return this.lockService.withLock(`lock:wallet:${secondWalletId}`, 5000, async () => {
    // Transfer logic here
    // Both wallets are locked
  });
});
```

This prevents deadlocks because:
- Thread A wants to transfer from wallet-a to wallet-b: locks [a, b]
- Thread B wants to transfer from wallet-b to wallet-a: locks [a, b] (same order!)
- No circular waiting → No deadlock

## Changes Made

### File: `wallet.repository.ts`

**Removed pessimistic locks from:**
1. ✅ `credit()` method
2. ✅ `debit()` method

**Before:**
```typescript
const wallet = await repo.findOne({
  where: { id: walletId },
  lock: { mode: 'pessimistic_write' }, // ❌ Caused transaction error
});
```

**After:**
```typescript
const wallet = await repo.findOne({
  where: { id: walletId }, // ✅ Simple query, protected by Redis lock
});
```

## Why This Works

### Single Instance
- Redis distributed lock ensures only one handler processes a wallet at a time
- No race conditions even within a single server

### Multiple Instances (Scaled)
- Redis distributed lock works across multiple server instances
- Lock is shared across all instances
- Only one instance can hold the lock for a wallet at any time

### Lock TTL (Time To Live)
- Lock automatically expires after 5 seconds
- Prevents deadlocks if a handler crashes
- Can be adjusted based on operation complexity

## Optimistic Locking (Entity Version)

We also use **optimistic locking** at the entity level for additional safety:

```typescript
@Entity('wallets')
export class WalletEntity {
  @VersionColumn({ name: 'version' })
  version: number; // Automatically incremented on each save
}
```

This provides a second layer of protection:
1. **Distributed lock** prevents concurrent handler execution
2. **Version column** detects if entity was modified between read and write

If somehow the distributed lock fails, the version check will catch it:
```typescript
// TypeORM automatically checks: WHERE id = ? AND version = ?
// If version changed, save fails → retry or error
await repo.save(wallet);
```

## Event Store Concurrency

The event store (KurrentDB) has its own concurrency control:

```typescript
await this.eventStore.appendToStream(
  walletId,
  events,
  expectedVersion, // ← Event store checks this
);
```

If events were appended by another process:
- KurrentDB throws `WrongExpectedVersionError`
- Handler catches it and throws `EventConcurrencyError`
- Client can retry

## Multi-Layer Protection

Our system uses **defense in depth** with multiple layers:

```
Layer 1: Distributed Lock (Redis)
  ↓ Prevents concurrent handler execution
  
Layer 2: Event Store Version Check (KurrentDB)
  ↓ Ensures event stream consistency
  
Layer 3: Entity Version Column (PostgreSQL)
  ↓ Detects concurrent modifications
  
Layer 4: Database Constraints (PostgreSQL)
  ↓ Ensures data integrity
```

## Performance Considerations

### ✅ Benefits
- **Fast**: Redis locks are very fast (typically < 1ms)
- **Scalable**: Works across multiple server instances
- **Reliable**: Redis is battle-tested for distributed locking
- **Simple**: No need for complex transaction management

### ⚠️ Considerations
- **Redis Dependency**: System requires Redis to be available
- **Lock Timeouts**: Operations must complete within TTL (5 seconds)
- **Lock Contention**: High contention on same wallet may cause delays

### 🔧 Tuning
```typescript
// Adjust lock TTL based on operation complexity
await this.lockService.withLock(
  `lock:wallet:${walletId}`,
  10000, // Increase if operations are slow
  async () => { /* ... */ }
);
```

## Testing Concurrency

### Test Scenario 1: Concurrent Credits
```bash
# Terminal 1
curl -X POST http://localhost:3000/wallets/test-wallet/credit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Terminal 2 (at same time)
curl -X POST http://localhost:3000/wallets/test-wallet/credit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Expected: Both succeed, balance increases by 200
```

### Test Scenario 2: Concurrent Debits
```bash
# Create wallet with 100 balance
curl -X POST http://localhost:3000/wallets/test-wallet \
  -H "Content-Type: application/json" \
  -d '{"walletId": "test-wallet", "ownerId": "user-1", "initialBalance": 100}'

# Try to debit 100 twice simultaneously
# Terminal 1 & 2 (at same time)
curl -X POST http://localhost:3000/wallets/test-wallet/debit \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Expected: One succeeds (balance = 0), other fails (insufficient funds)
```

### Load Testing
```bash
# Run concurrent operations
npm run load-test
# or
./scripts/spam-credit.sh test-wallet 1000
```

## Troubleshooting

### Redis Connection Issues
```
Error: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**: Ensure Redis is running
```bash
redis-cli ping
# Should respond: PONG
```

### Lock Timeout
```
Error: Failed to acquire lock within timeout
```

**Solutions**:
1. Increase lock TTL in handler
2. Check if operations are taking too long
3. Verify Redis is not under heavy load

### Lost Locks
If server crashes while holding lock:
- Lock expires after TTL (5 seconds by default)
- Other servers can acquire lock after expiry
- No manual intervention needed

## Best Practices

### ✅ Do
- Use distributed locks for all wallet modifications
- Keep operations within lock as short as possible
- Use consistent lock ordering for multi-wallet operations
- Log lock acquisition and release for debugging
- Monitor lock contention metrics

### ❌ Don't
- Don't use pessimistic database locks (redundant with Redis locks)
- Don't perform long-running operations inside locks
- Don't acquire locks in inconsistent order (causes deadlocks)
- Don't rely solely on database locks in distributed systems

## Related Files

- `src/wallet/infrastructure/lock/distributed-lock.service.ts` - Lock implementation
- `src/wallet/infrastructure/persistence/wallet.repository.ts` - Repository methods
- `src/wallet/application/commands/handlers/*.ts` - Command handlers using locks
- `src/wallet/domain/entities/wallet.entity.ts` - Entity with version column

## References

- [Redlock Algorithm](https://redis.io/topics/distlock) - Distributed lock algorithm
- [Optimistic vs Pessimistic Locking](https://docs.nestjs.com/techniques/database#optimistic-locking)
- [Event Sourcing Concurrency](https://www.eventstore.com/blog/optimistic-concurrency-in-event-sourcing)

