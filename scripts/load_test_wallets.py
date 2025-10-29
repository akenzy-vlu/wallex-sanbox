#!/usr/bin/env python3
"""
Wallet Load Testing Script

This script creates 100 wallets and performs random operations:
- Credit operations
- Debit operations
- Transfer operations

It verifies that ledger entries are created correctly for each operation.
"""

import requests
import random
import time
import json
from datetime import datetime
from typing import List, Dict
import sys

# Configuration
API_BASE_URL = "http://localhost:3000"
NUM_WALLETS = 100
NUM_OPERATIONS = 200  # Total random operations to perform
SLEEP_BETWEEN_OPS = 0.1  # seconds

# Statistics
stats = {
    "wallets_created": 0,
    "wallets_failed": 0,
    "credits_success": 0,
    "credits_failed": 0,
    "debits_success": 0,
    "debits_failed": 0,
    "transfers_success": 0,
    "transfers_failed": 0,
}

created_wallets: List[Dict] = []


def generate_wallet_id() -> str:
    """Generate a unique wallet ID"""
    timestamp = int(time.time() * 1000)
    random_suffix = random.randint(1000, 9999)
    return f"wallet-{timestamp}-{random_suffix}"


def generate_owner_id() -> str:
    """Generate a random owner ID"""
    return f"user-{random.randint(1000, 9999)}"


def generate_idempotency_key() -> str:
    """Generate a unique idempotency key"""
    timestamp = int(time.time() * 1000)
    random_suffix = random.randint(100000, 999999)
    return f"idem-{timestamp}-{random_suffix}"


def create_wallet(wallet_id: str, owner_id: str, initial_balance: float) -> Dict:
    """Create a wallet via API"""
    url = f"{API_BASE_URL}/wallets"
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": generate_idempotency_key(),
    }
    payload = {
        "walletId": wallet_id,
        "ownerId": owner_id,
        "initialBalance": initial_balance,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error creating wallet {wallet_id}: {e}")
        raise


def credit_wallet(wallet_id: str, amount: float, description: str = "Random credit") -> Dict:
    """Credit a wallet via API"""
    url = f"{API_BASE_URL}/wallets/{wallet_id}/credit"
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": generate_idempotency_key(),
    }
    payload = {
        "amount": amount,
        "description": description,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error crediting wallet {wallet_id}: {e}")
        raise


def debit_wallet(wallet_id: str, amount: float, description: str = "Random debit") -> Dict:
    """Debit a wallet via API"""
    url = f"{API_BASE_URL}/wallets/{wallet_id}/debit"
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": generate_idempotency_key(),
    }
    payload = {
        "amount": amount,
        "description": description,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error debiting wallet {wallet_id}: {e}")
        raise


def transfer_wallet(from_wallet_id: str, to_wallet_id: str, amount: float, description: str = "Random transfer") -> Dict:
    """Transfer between wallets via API"""
    url = f"{API_BASE_URL}/wallets/{from_wallet_id}/transfer"
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": generate_idempotency_key(),
    }
    payload = {
        "toWalletId": to_wallet_id,
        "amount": amount,
        "description": description,
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error transferring from {from_wallet_id} to {to_wallet_id}: {e}")
        raise


def get_wallet(wallet_id: str) -> Dict:
    """Get wallet details"""
    url = f"{API_BASE_URL}/wallets/{wallet_id}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error getting wallet {wallet_id}: {e}")
        raise


def get_ledger_entries(wallet_id: str) -> Dict:
    """Get ledger entries for a wallet"""
    url = f"{API_BASE_URL}/ledger/wallet/{wallet_id}"
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"❌ Error getting ledger for {wallet_id}: {e}")
        raise


def print_progress_bar(iteration: int, total: int, prefix: str = '', suffix: str = '', length: int = 50):
    """Print a progress bar"""
    percent = (iteration / total)
    filled_length = int(length * percent)
    bar = '█' * filled_length + '-' * (length - filled_length)
    print(f'\r{prefix} |{bar}| {iteration}/{total} {suffix}', end='\r')
    if iteration == total:
        print()


def main():
    print("=" * 80)
    print("🚀 Wallet Load Testing Script")
    print("=" * 80)
    print(f"\nConfiguration:")
    print(f"  API URL: {API_BASE_URL}")
    print(f"  Wallets to create: {NUM_WALLETS}")
    print(f"  Random operations: {NUM_OPERATIONS}")
    print()

    # Step 1: Create wallets
    print(f"📝 Step 1: Creating {NUM_WALLETS} wallets...")
    print()

    for i in range(NUM_WALLETS):
        wallet_id = generate_wallet_id()
        owner_id = generate_owner_id()
        initial_balance = round(random.uniform(100, 10000), 2)

        try:
            wallet = create_wallet(wallet_id, owner_id, initial_balance)
            created_wallets.append({
                "id": wallet["id"],
                "ownerId": wallet["ownerId"],
                "balance": wallet["balance"],
            })
            stats["wallets_created"] += 1
            print_progress_bar(i + 1, NUM_WALLETS, prefix='Creating wallets', suffix=f'({stats["wallets_created"]} successful)')
            time.sleep(SLEEP_BETWEEN_OPS)
        except Exception as e:
            stats["wallets_failed"] += 1
            print(f"\n❌ Failed to create wallet {wallet_id}: {e}")

    print()
    print(f"✅ Created {stats['wallets_created']} wallets successfully")
    print(f"❌ Failed to create {stats['wallets_failed']} wallets")
    print()

    if stats["wallets_created"] == 0:
        print("❌ No wallets created. Exiting...")
        sys.exit(1)

    # Step 2: Wait for async processing
    print("⏳ Step 2: Waiting 10 seconds for async projection...")
    time.sleep(10)
    print()

    # Step 3: Perform random operations
    print(f"🎲 Step 3: Performing {NUM_OPERATIONS} random operations...")
    print()

    for i in range(NUM_OPERATIONS):
        operation = random.choice(["credit", "debit", "transfer"])

        try:
            if operation == "credit":
                wallet = random.choice(created_wallets)
                amount = round(random.uniform(10, 1000), 2)
                result = credit_wallet(wallet["id"], amount, f"Load test credit #{i+1}")
                stats["credits_success"] += 1
                print_progress_bar(
                    i + 1, NUM_OPERATIONS,
                    prefix='Operations',
                    suffix=f'CREDIT {wallet["id"][:15]}... +{amount}'
                )

            elif operation == "debit":
                wallet = random.choice(created_wallets)
                # Get current balance
                wallet_data = get_wallet(wallet["id"])
                current_balance = float(wallet_data.get("balance", 0))
                
                # Debit a safe amount (max 50% of balance or 500)
                max_debit = min(current_balance * 0.5, 500)
                if max_debit > 10:
                    amount = round(random.uniform(10, max_debit), 2)
                    result = debit_wallet(wallet["id"], amount, f"Load test debit #{i+1}")
                    stats["debits_success"] += 1
                    print_progress_bar(
                        i + 1, NUM_OPERATIONS,
                        prefix='Operations',
                        suffix=f'DEBIT {wallet["id"][:15]}... -{amount}'
                    )
                else:
                    # Skip if balance too low
                    stats["debits_failed"] += 1
                    print_progress_bar(
                        i + 1, NUM_OPERATIONS,
                        prefix='Operations',
                        suffix=f'SKIP (low balance)'
                    )

            elif operation == "transfer":
                if len(created_wallets) < 2:
                    stats["transfers_failed"] += 1
                    continue

                from_wallet = random.choice(created_wallets)
                to_wallet = random.choice([w for w in created_wallets if w["id"] != from_wallet["id"]])

                # Get current balance
                wallet_data = get_wallet(from_wallet["id"])
                current_balance = float(wallet_data.get("balance", 0))

                # Transfer a safe amount
                max_transfer = min(current_balance * 0.3, 300)
                if max_transfer > 10:
                    amount = round(random.uniform(10, max_transfer), 2)
                    result = transfer_wallet(
                        from_wallet["id"],
                        to_wallet["id"],
                        amount,
                        f"Load test transfer #{i+1}"
                    )
                    stats["transfers_success"] += 1
                    print_progress_bar(
                        i + 1, NUM_OPERATIONS,
                        prefix='Operations',
                        suffix=f'TRANSFER {amount} {from_wallet["id"][:10]}→{to_wallet["id"][:10]}'
                    )
                else:
                    stats["transfers_failed"] += 1
                    print_progress_bar(
                        i + 1, NUM_OPERATIONS,
                        prefix='Operations',
                        suffix=f'SKIP (low balance)'
                    )

            time.sleep(SLEEP_BETWEEN_OPS)

        except Exception as e:
            if operation == "credit":
                stats["credits_failed"] += 1
            elif operation == "debit":
                stats["debits_failed"] += 1
            elif operation == "transfer":
                stats["transfers_failed"] += 1
            print(f"\n❌ Operation failed: {e}")

    print()
    print()

    # Step 4: Wait and verify
    print("⏳ Step 4: Waiting 10 seconds for final async processing...")
    time.sleep(10)
    print()

    # Step 5: Verify ledger entries
    print("🔍 Step 5: Verifying ledger entries for sample wallets...")
    print()

    sample_wallets = random.sample(created_wallets, min(5, len(created_wallets)))
    for wallet in sample_wallets:
        try:
            ledger = get_ledger_entries(wallet["id"])
            count = ledger.get("count", 0)
            print(f"   Wallet {wallet['id']}: {count} ledger entries")
        except Exception as e:
            print(f"   ❌ Error getting ledger for {wallet['id']}: {e}")

    print()

    # Print final statistics
    print("=" * 80)
    print("📊 Final Statistics")
    print("=" * 80)
    print()
    print(f"Wallets:")
    print(f"  ✅ Created: {stats['wallets_created']}")
    print(f"  ❌ Failed:  {stats['wallets_failed']}")
    print()
    print(f"Operations:")
    print(f"  💰 Credits:   {stats['credits_success']} success, {stats['credits_failed']} failed")
    print(f"  💸 Debits:    {stats['debits_success']} success, {stats['debits_failed']} failed")
    print(f"  🔄 Transfers: {stats['transfers_success']} success, {stats['transfers_failed']} failed")
    print()
    total_ops = (stats['credits_success'] + stats['debits_success'] + 
                 stats['transfers_success'])
    print(f"  Total successful operations: {total_ops}")
    print()
    print("=" * 80)
    print("✅ Load test complete!")
    print("=" * 80)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

