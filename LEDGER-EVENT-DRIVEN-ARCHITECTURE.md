# Ledger Event-Driven Architecture

This document explains the event-driven architecture used to integrate the ledger with wallet operations.

## Architecture Overview

The ledger system follows an **event-driven projection pattern** that is decoupled from the wallet module:

```
┌─────────────────┐
│  Wallet Handler │
│                 │
│  1. Create/     │
│     modify      │
│     aggregate   │
│                 │
│  2. Store       │
│     events      │
└────────┬────────┘
         │
         ├──────► Event Store (Source of Truth)
         │
         v
┌────────────────────────────────┐
│  After Events Committed:       │
│                                │
│  ┌──────────────────────────┐ │
│  │ WalletProjectionService  │ │
│  │ (Read Model - ES)        │ │
│  └──────────────────────────┘ │
│                                │
│  ┌──────────────────────────┐ │
│  │ LedgerProjectionService  │ │
│  │ (Audit Trail - DB)       │ │
│  └──────────────────────────┘ │
└────────────────────────────────┘
```

## Key Principles

### 1. Event Store as Source of Truth
- All state changes are captured as events in the event store
- Events are immutable and timestamped
- Ledger is a **derived view** (projection) of these events

### 2. Separation of Concerns
- **Wallet Module**: Business logic for wallet operations
- **Ledger Module**: Audit trail projection and queries
- No direct coupling between modules

### 3. Eventually Consistent
- Ledger entries are created asynchronously after events are stored
- If ledger projection fails, events remain in event store
- Ledger can be rebuilt from event store if needed

## Implementation Details

### Event Flow

#### 1. Wallet Creation
```typescript
WalletCreatedEvent → LedgerProjectionService → LedgerEntry (CREDIT if initial balance > 0)
```

#### 2. Credit Transaction
```typescript
WalletCreditedEvent → LedgerProjectionService → LedgerEntry (CREDIT)
```

#### 3. Debit Transaction
```typescript
WalletDebitedEvent → LedgerProjectionService → LedgerEntry (DEBIT)
```

#### 4. Transfer Transaction
```typescript
WalletDebitedEvent (from wallet) + WalletCreditedEvent (to wallet)
  → LedgerProjectionService
  → LedgerEntry (TRANSFER_OUT) + LedgerEntry (TRANSFER_IN)
```

### Components

#### 1. LedgerProjectionService
Location: `src/ledger/application/ledger-projection.service.ts`

Main orchestrator that:
- Receives wallet events from handlers
- Maintains balance cache to track before/after balances
- Delegates to specific event handlers
- Handles errors gracefully (doesn't fail wallet operations)

```typescript
@Injectable()
export class LedgerProjectionService {
  async project(events: StoredWalletEvent[]): Promise<void> {
    for (const event of events) {
      switch (event.type) {
        case 'WalletCreated':
          await this.onWalletCreated(event);
          break;
        case 'WalletCredited':
          await this.onWalletCredited(event);
          break;
        case 'WalletDebited':
          await this.onWalletDebited(event);
          break;
      }
    }
  }
}
```

#### 2. Event Handlers
Location: `src/ledger/application/event-handlers/`

Specialized handlers for each event type:
- **WalletCreatedEventHandler**: Records initial balance as CREDIT
- **WalletCreditedEventHandler**: Records credit transactions
- **WalletDebitedEventHandler**: Records debit or transfer-out transactions

Each handler:
- Extracts relevant data from the event
- Calculates balances
- Creates ledger entries via LedgerService
- Handles errors without throwing

#### 3. Integration in Wallet Handlers

All wallet command handlers follow this pattern:

```typescript
@CommandHandler(CreditWalletCommand)
export class CreditWalletHandler {
  constructor(
    private readonly eventStore: EventStoreDbService,
    private readonly projection: WalletProjectionService,
    private readonly ledgerProjection: LedgerProjectionService,
    // ... other dependencies
  ) {}

  async execute(command: CreditWalletCommand) {
    // 1. Load aggregate
    const aggregate = ...;
    
    // 2. Apply business logic
    aggregate.credit(amount);
    
    // 3. Store events
    const committedEvents = await this.eventStore.appendToStream(...);
    
    // 4. Project to read model
    await this.projection.project(committedEvents);
    
    // 5. Project to ledger
    await this.ledgerProjection.project(committedEvents);
    
    // 6. Mark as committed
    aggregate.markEventsCommitted();
    
    return aggregate.snapshot();
  }
}
```

## Benefits of This Architecture

### 1. Decoupling
- Wallet module doesn't know about ledger
- Changes to ledger don't affect wallet logic
- Easy to add more projections in the future

### 2. Reliability
- Event store is always consistent
- Ledger can fail without breaking wallet operations
- Ledger can be rebuilt from events if corrupted

### 3. Auditability
- Complete event history in event store
- Ledger provides efficient querying
- Can trace any transaction back to source event

### 4. Scalability
- Projections can run independently
- Can add read replicas for ledger queries
- Event processing can be parallelized

### 5. Flexibility
- Easy to add new event types
- Can create multiple projections from same events
- Support for event replay and debugging

## Error Handling

The ledger projection is designed to be **fault-tolerant**:

```typescript
try {
  await this.ledgerService.recordEntry({...});
} catch (error) {
  this.logger.error(`Failed to create ledger entry: ${error.message}`);
  // Don't throw - ledger is supplementary
}
```

**Key Points:**
- Ledger errors are logged but don't fail wallet operations
- Events remain in event store for replay
- Can manually trigger replay to fix ledger

## Rebuilding the Ledger

If the ledger becomes inconsistent, it can be rebuilt:

1. **Clear ledger entries** (or specific wallet entries)
2. **Replay events from event store**
3. **Verify consistency**

```typescript
// Example: Rebuild ledger for a specific wallet
async rebuildLedgerForWallet(walletId: string) {
  // 1. Clear existing entries
  await this.ledgerRepository.delete({ walletId });
  
  // 2. Load all events from event store
  const events = await this.eventStore.readStream(walletId);
  
  // 3. Project events to ledger
  await this.ledgerProjection.project(events);
  
  // 4. Verify
  const summary = await this.ledgerService.getWalletBalanceSummary(walletId);
  // Compare with current wallet balance
}
```

## Transaction Types and Event Mapping

| Event Type                   | Ledger Transaction Type | Notes                   |
| ---------------------------- | ----------------------- | ----------------------- |
| WalletCreated (with balance) | CREDIT                  | Initial balance only    |
| WalletCredited               | CREDIT                  | All credit operations   |
| WalletDebited (standalone)   | DEBIT                   | Non-transfer debits     |
| WalletDebited (in transfer)  | TRANSFER_OUT            | Detected by description |
| WalletCredited (in transfer) | TRANSFER_IN             | Detected by description |

## Transfer Handling

Transfers create two related ledger entries:

```typescript
// Source wallet debit event
WalletDebitedEvent {
  aggregateId: "wallet-A",
  amount: 50,
  description: "Transfer to wallet wallet-B"
}
→ LedgerEntry { type: TRANSFER_OUT, relatedWalletId: "wallet-B" }

// Destination wallet credit event
WalletCreditedEvent {
  aggregateId: "wallet-B", 
  amount: 50,
  description: "Transfer from wallet wallet-A"
}
→ LedgerEntry { type: TRANSFER_IN, relatedWalletId: "wallet-A" }
```

Both entries are processed in the same projection batch, maintaining consistency.

## Balance Tracking

The `LedgerProjectionService` maintains an in-memory balance cache:

```typescript
private balanceCache = new Map<string, number>();
```

**Purpose:**
- Track balance before/after each event
- Calculate accurate ledger entries
- Independent from wallet aggregate state

**Lifecycle:**
- Initialized when WalletCreated event is processed
- Updated with each credit/debit event
- Cleared via `clearCache()` for testing

## Monitoring and Observability

### Logging
All projection operations are logged:

```typescript
this.logger.log(`Ledger entry created for wallet ${walletId} credit`);
this.logger.error(`Failed to create ledger entry: ${error.message}`);
```

### Metrics to Monitor
1. **Projection lag**: Time between event commit and ledger entry creation
2. **Projection errors**: Failed ledger entry creations
3. **Ledger balance vs wallet balance**: Consistency checks

## Testing Strategy

### Unit Tests
- Test individual event handlers
- Mock LedgerService
- Verify correct transaction types and balances

### Integration Tests
- Test full projection flow
- Verify ledger entries match events
- Test error scenarios

### End-to-End Tests
- Create wallets and perform operations
- Query ledger entries
- Verify consistency

## Migration from Direct Integration

If you previously had direct `LedgerService` calls in wallet handlers:

**Before:**
```typescript
// Direct coupling
await this.ledgerService.recordEntry({...});
```

**After:**
```typescript
// Event-driven
await this.ledgerProjection.project(committedEvents);
```

**Benefits:**
- ✅ Cleaner separation of concerns
- ✅ More reliable (ledger can't break wallet operations)
- ✅ Easier to test
- ✅ Can replay events
- ✅ Better scalability

## Best Practices

1. **Always project after committing events**
   - Ensures ledger reflects committed state
   - Maintains consistency

2. **Handle projection errors gracefully**
   - Log errors but don't throw
   - Implement retry mechanisms if needed

3. **Keep projection logic simple**
   - Extract complex logic to handlers
   - Focus on event-to-ledger mapping

4. **Monitor projection health**
   - Track lag and errors
   - Set up alerts for failures

5. **Design for idempotency**
   - Handle duplicate event processing
   - Use event version numbers

## Future Enhancements

Potential improvements:

1. **Async Event Processing**
   - Use message queue for projections
   - Decouple projection from command execution

2. **Bulk Replay**
   - Tool to rebuild ledger from event store
   - Support for date ranges

3. **Projection Checkpoints**
   - Track last processed event
   - Resume from checkpoint on restart

4. **Multi-Tenant Support**
   - Partition ledger by tenant
   - Separate projection services

5. **Real-time Updates**
   - WebSocket notifications for ledger entries
   - Subscribe to wallet events

## Related Documentation

- `LEDGER-IMPLEMENTATION.md` - Detailed implementation guide
- `LEDGER-SETUP-GUIDE.md` - Setup instructions
- Event Sourcing patterns
- CQRS architecture

