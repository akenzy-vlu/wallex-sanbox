#!/bin/bash

# Script to migrate wallet IDs from UUID to VARCHAR
# This script handles the database migration for changing wallet ID column types

set -e

echo "================================"
echo "Wallet ID Migration Script"
echo "UUID → VARCHAR(255)"
echo "================================"
echo ""

# Check if PostgreSQL is running
echo "Checking PostgreSQL connection..."
if ! pg_isready -h localhost -p 5434 -U postgres > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running or not accessible"
    echo "Please start PostgreSQL and try again"
    exit 1
fi

echo "✅ PostgreSQL is running"
echo ""

# Ask user for confirmation
echo "This will:"
echo "1. Drop foreign key constraints"
echo "2. Change wallet.id from UUID to VARCHAR(255)"
echo "3. Change holds.wallet_id from UUID to VARCHAR(255)"
echo "4. Recreate foreign key constraints"
echo ""
read -p "Do you want to proceed? (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled"
    exit 0
fi

echo ""
echo "Running migration..."
echo ""

# Run the migration
npm run migration:run

if [ $? -eq 0 ]; then
    echo ""
    echo "================================"
    echo "✅ Migration completed successfully!"
    echo "================================"
    echo ""
    echo "You can now use custom wallet IDs like:"
    echo "  - akenzy-wallet4666"
    echo "  - user-123-wallet"
    echo "  - any-custom-format"
    echo ""
    echo "Test with:"
    echo "  curl -X POST http://localhost:3000/wallets \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"walletId\": \"akenzy-wallet4666\", \"ownerId\": \"user-123\", \"initialBalance\": 100}'"
    echo ""
else
    echo ""
    echo "================================"
    echo "❌ Migration failed"
    echo "================================"
    echo ""
    echo "Please check the error messages above"
    echo "You may need to:"
    echo "  1. Clear existing data (see WALLET-ID-MIGRATION.md)"
    echo "  2. Run migration manually (see WALLET-ID-MIGRATION.md)"
    echo "  3. Check database permissions"
    echo ""
    exit 1
fi

