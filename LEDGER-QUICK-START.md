# Ledger Quick Start

## TL;DR

The ledger now uses **event-driven projection** instead of direct service calls. This provides better separation of concerns and follows event sourcing best practices.

## Setup (3 steps)

```bash
# 1. Install dependencies
npm install

# 2. Run migration
npm run migration:run

# 3. Start the app
npm run start:dev
```

## How It Works

```
Wallet Operation → Events → Event Store
                     ↓
           ┌─────────┴─────────┐
           ↓                   ↓
    Wallet Projection   Ledger Projection
           ↓                   ↓
    Elasticsearch         PostgreSQL
    (Read Model)       (Audit Trail)
```

## Key Points

✅ **Event-Driven**: Ledger listens to wallet events  
✅ **Decoupled**: Wallet and ledger modules are independent  
✅ **Fault-Tolerant**: Ledger errors don't break wallet operations  
✅ **Rebuildable**: Can reconstruct ledger from event store  

## Architecture Files

- 📘 **Setup Guide**: `LEDGER-SETUP-GUIDE.md` - How to set up
- 📗 **Implementation**: `LEDGER-IMPLEMENTATION.md` - What was built
- 📙 **Architecture**: `LEDGER-EVENT-DRIVEN-ARCHITECTURE.md` - How it works
- 📕 **Refactoring**: `REFACTORING-SUMMARY.md` - What changed

## Test It

```bash
# Create wallet
curl -X POST http://localhost:3000/wallet \
  -H "Content-Type: application/json" \
  -d '{"walletId": "user-123", "ownerId": "user-123", "initialBalance": 100}'

# Check ledger
curl http://localhost:3000/ledger/wallet/user-123
```

## Code Example

### Wallet Handler (Simplified)
```typescript
// Store events
const events = await this.eventStore.appendToStream(...);

// Project to read model
await this.projection.project(events);

// Project to ledger (NEW!)
await this.ledgerProjection.project(events);
```

### Event Handler (Ledger)
```typescript
@Injectable()
export class WalletCreditedEventHandler {
  async handle(event, balanceBefore, balanceAfter) {
    await this.ledgerService.recordEntry({
      walletId: event.aggregateId,
      transactionType: TransactionType.CREDIT,
      amount: event.data.amount,
      balanceBefore,
      balanceAfter,
      // ...
    });
  }
}
```

## API Endpoints

```bash
# Get wallet transactions
GET /ledger/wallet/:walletId

# Get wallet summary
GET /ledger/wallet/:walletId/summary

# Get transfer transactions
GET /ledger/reference/:referenceId

# Get all transactions
GET /ledger/transactions
```

## Need Help?

1. Read `LEDGER-SETUP-GUIDE.md` for detailed setup
2. Read `LEDGER-EVENT-DRIVEN-ARCHITECTURE.md` for architecture
3. Read `REFACTORING-SUMMARY.md` for what changed
4. Check the code in `src/ledger/`

## Benefits

| Before                  | After                   |
| ----------------------- | ----------------------- |
| Direct service calls    | Event-driven projection |
| Tight coupling          | Loose coupling          |
| Ledger can break wallet | Fault-tolerant          |
| Hard to test            | Easy to test            |
| Can't replay            | Can rebuild from events |

## That's It!

The ledger is now implemented using event sourcing best practices. It's decoupled, reliable, and maintainable. 🎉

