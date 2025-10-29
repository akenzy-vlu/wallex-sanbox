# Wallet ID Type Migration: UUID → VARCHAR

## Overview
Changed wallet ID column type from `uuid` to `varchar(255)` to support custom wallet ID formats like "akenzy-wallet4666" instead of strict UUID format.

## Changes Made

### 1. Entity Updates

#### WalletEntity
**File**: `src/wallet/domain/entities/wallet.entity.ts`

Changed:
```typescript
@PrimaryColumn('uuid')
id: string;
```

To:
```typescript
@PrimaryColumn({ type: 'varchar', length: 255 })
id: string;
```

#### HoldEntity
**File**: `src/wallet/domain/entities/hold.entity.ts`

Changed:
```typescript
@Column({ type: 'uuid', name: 'wallet_id' })
walletId: string;
```

To:
```typescript
@Column({ type: 'varchar', length: 255, name: 'wallet_id' })
walletId: string;
```

### 2. Database Migration

**File**: `src/database/migrations/1730000000002-ChangeWalletIdToVarchar.ts`

Created a new migration that:
1. Drops the foreign key constraint from `holds` table
2. Changes `wallet_id` column in `holds` table to `varchar(255)`
3. Changes `id` column in `wallets` table to `varchar(255)`
4. Recreates the foreign key constraint

## Migration Steps

### Option 1: Fresh Database (Recommended for Development)

If you have no important data, the easiest approach is to drop and recreate:

```bash
# Drop existing database
psql -U postgres -c "DROP DATABASE IF EXISTS wallex;"

# Create fresh database
psql -U postgres -c "CREATE DATABASE wallex;"

# Run all migrations
npm run migration:run
# or
yarn migration:run
```

### Option 2: Migrate Existing Database

If you have existing data:

```bash
# Run the migration
npm run migration:run
# or
yarn migration:run
```

**⚠️ Warning**: If you have existing wallet records with UUID format IDs, this migration will work. However, if any wallets have IDs that aren't valid UUIDs, the down migration won't work correctly.

### Option 3: Manual Migration (if TypeORM migration fails)

If you need to migrate manually:

```sql
-- Drop foreign key
ALTER TABLE "holds" DROP CONSTRAINT "FK_HOLDS_WALLET";

-- Change wallet_id in holds table
ALTER TABLE "holds" ALTER COLUMN "wallet_id" TYPE varchar(255);

-- Change id in wallets table
ALTER TABLE "wallets" ALTER COLUMN "id" TYPE varchar(255);

-- Recreate foreign key
ALTER TABLE "holds" 
  ADD CONSTRAINT "FK_HOLDS_WALLET" 
  FOREIGN KEY ("wallet_id") 
  REFERENCES "wallets"("id") 
  ON DELETE CASCADE 
  ON UPDATE CASCADE;
```

## Testing

After migration, test with custom wallet IDs:

```bash
# Create a wallet with custom ID format
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{
    "walletId": "akenzy-wallet4666",
    "ownerId": "user-123",
    "initialBalance": 100
  }'

# Verify it was created
curl http://localhost:3000/wallets/akenzy-wallet4666
```

## Supported ID Formats

After this change, you can use any string format for wallet IDs (up to 255 characters):

✅ Valid formats:
- `akenzy-wallet4666`
- `user-123-wallet`
- `wallet_abc123`
- `550e8400-e29b-41d4-a716-446655440000` (UUID format still works)
- `WALLET-2024-001`
- Any custom format you need

❌ Invalid:
- IDs longer than 255 characters
- Empty strings
- IDs with special SQL characters (should be sanitized by TypeORM)

## Rollback

If you need to rollback to UUID format:

```bash
# Revert the migration
npm run migration:revert
# or
yarn migration:revert
```

**⚠️ Warning**: Rollback will only work if all existing wallet IDs are valid UUIDs!

## Impact

### ✅ Benefits
- Supports human-readable wallet IDs
- Supports custom ID formats (e.g., business rules, naming conventions)
- More flexibility for integration with external systems
- No need to generate UUIDs for every wallet

### ⚠️ Considerations
- Slightly larger index size (varchar vs uuid)
- No built-in UUID validation at database level
- Application must ensure ID uniqueness

### 📊 Performance Impact
- Minimal: VARCHAR(255) vs UUID has negligible performance difference for typical wallet operations
- Indexes work efficiently with varchar primary keys
- Foreign key lookups remain fast

## Repository Methods

All repository methods work unchanged with varchar IDs:

```typescript
// All these methods work the same way
walletRepository.findById('akenzy-wallet4666')
walletRepository.create('custom-wallet-123', 'owner-1', 100)
walletRepository.credit('my-wallet', 50)
walletRepository.debit('my-wallet', 25)
walletRepository.transfer('wallet-a', 'wallet-b', 100)
```

## Related Files

- `src/wallet/domain/entities/wallet.entity.ts` - Wallet entity definition
- `src/wallet/domain/entities/hold.entity.ts` - Hold entity definition
- `src/wallet/infrastructure/persistence/wallet.repository.ts` - Repository methods
- `src/database/migrations/1730000000002-ChangeWalletIdToVarchar.ts` - Migration file
- `src/database/migrations/1730000000000-CreateWalletsTable.ts` - Original wallets table
- `src/database/migrations/1730000000001-CreateHoldsTable.ts` - Original holds table

## Questions?

If you encounter issues:
1. Check that PostgreSQL is running
2. Verify database connection in `.env` or `typeorm.config.ts`
3. Ensure no existing foreign key constraints are blocking the migration
4. Check for data that might prevent the column type change

