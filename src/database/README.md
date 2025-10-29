# Database Layer

This directory contains the database configuration, migrations, and persistence layer for the Wallex application.

## Overview

The application uses **PostgreSQL** with **TypeORM** for the domain and persistence layer, alongside:
- **KurrentDB** for event sourcing
- **Elasticsearch** for read model projections
- **Redis** for distributed locks

## Database Entities

### WalletEntity
- **Purpose**: Stores wallet state with balance tracking
- **Key Fields**:
  - `id` (UUID): Primary key
  - `ownerId`: User/owner identifier
  - `balance`: Total wallet balance (decimal 19,4)
  - `heldBalance`: Amount currently held
  - `availableBalance`: Calculated available balance
  - `status`: ACTIVE, SUSPENDED, or CLOSED
  - `version`: Optimistic locking version
  - `currency`: Currency code (default: USD)
  - `metadata`: Additional JSON data

### HoldEntity
- **Purpose**: Represents holds/reservations on wallet funds
- **Key Fields**:
  - `id` (UUID): Primary key
  - `walletId`: Foreign key to wallet
  - `amount`: Hold amount
  - `status`: ACTIVE, RELEASED, EXPIRED, or CAPTURED
  - `type`: PAYMENT, AUTHORIZATION, REFUND, ESCROW, or OTHER
  - `reference`: External reference
  - `expiresAt`: Optional expiration timestamp

## Migrations

### Running Migrations

```bash
# Build the project first
npm run build

# Run pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Show migration status
npm run migration:show
```

### Creating New Migrations

```bash
# Generate migration from entity changes
npm run migration:generate -- src/database/migrations/MigrationName

# Create empty migration
npm run migration:create -- src/database/migrations/MigrationName
```

## Configuration

Database configuration is managed through environment variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=wallex
DB_SYNC=false          # Never true in production!
DB_LOGGING=false
DB_RUN_MIGRATIONS=false
DB_SSL=false
```

## Transactional Support

The `WalletRepository` provides transaction support:

```typescript
// Example: Transfer with transaction
await walletRepository.transfer(fromWalletId, toWalletId, amount);

// Custom transaction
await walletRepository.transaction(async (manager) => {
  // Operations using manager
  await walletRepository.debit(walletId, amount, manager);
  await holdRepository.create(holdData, manager);
});
```

## Concurrency Control

### Optimistic Locking
- Uses `@VersionColumn` on WalletEntity
- Automatic version increment on updates
- Throws `EventConcurrencyError` on conflicts

### Pessimistic Locking
- Used in credit/debit operations
- `{ lock: { mode: 'pessimistic_write' } }`
- Prevents concurrent balance modifications

## Docker Setup

Start PostgreSQL with Docker Compose:

```bash
# Start all services including PostgreSQL
docker-compose up -d postgres

# Check PostgreSQL status
docker-compose ps postgres

# View logs
docker-compose logs -f postgres
```

## Best Practices

1. **Never use `DB_SYNC=true` in production**
2. **Always use migrations** for schema changes
3. **Use transactions** for multi-step operations
4. **Leverage optimistic locking** for aggregate versioning
5. **Use pessimistic locking** for critical balance operations
6. **Index frequently queried fields**
7. **Monitor hold expirations** and clean up expired holds

## Architecture

```
src/database/
├── database.module.ts          # TypeORM configuration module
├── data-source.ts              # CLI DataSource configuration
├── migrations/                 # Database migrations
│   ├── *-CreateWalletsTable.ts
│   └── *-CreateHoldsTable.ts
└── README.md                   # This file
```

## Related Components

- **Domain Entities**: `src/wallet/domain/entities/`
- **Repositories**: `src/wallet/infrastructure/persistence/`
- **Event Store**: `src/wallet/infrastructure/event-store/`
- **Read Model**: `src/wallet/infrastructure/read-model/`

