#!/usr/bin/env python3
"""
Quick Wallet Load Test - Creates wallets and performs random operations

Usage:
    python quick_load_test.py --wallets 100 --operations 200
    python quick_load_test.py --wallets 50 --operations 100 --fast
"""

import requests
import random
import time
import argparse
import os
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

API_BASE_URL = "http://localhost:3000"

# Stats tracking
stats = {
    "wallets": {"success": 0, "failed": 0},
    "credit": {"success": 0, "failed": 0},
    "debit": {"success": 0, "failed": 0},
    "transfer": {"success": 0, "failed": 0},
}

created_wallets = []


def cap_path():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'debug-captures'))
    os.makedirs(base_dir, exist_ok=True)
    filename = datetime.utcnow().strftime('%Y-%m-%d') + '.loadtest.cap.jsonl'
    return os.path.join(base_dir, filename)


def write_cap(record):
    try:
        with open(cap_path(), 'a', encoding='utf-8') as f:
            f.write(f"{record}\n")
    except Exception:
        pass


def gen_id(prefix="id"):
    """Generate unique ID"""
    return f"{prefix}-{int(time.time()*1000)}-{random.randint(1000,9999)}"


def create_wallet(idx):
    """Create a single wallet"""
    wallet_id = gen_id("wallet")
    owner_id = gen_id("user")
    # Use integer amount to align with server-side integer arithmetic
    initial_balance = random.randint(100, 5000)
    
    try:
        response = requests.post(
            f"{API_BASE_URL}/wallets",
            json={
                "walletId": wallet_id,
                "ownerId": owner_id,
                "initialBalance": initial_balance
            },
            headers={"Idempotency-Key": gen_id("idem")},
            timeout=10
        )
        response.raise_for_status()
        return {"success": True, "data": response.json()}
    except Exception as e:
        write_cap(
            __import__('json').dumps({
                "timestamp": datetime.utcnow().isoformat(),
                "source": "loadtest",
                "type": "create_wallet_error",
                "error": str(e),
                "payload": {"walletId": wallet_id, "ownerId": owner_id, "initialBalance": initial_balance},
            })
        )
        return {"success": False, "error": str(e), "wallet_id": wallet_id}


def perform_operation(op_type, wallet_ids):
    """Perform a random operation"""
    try:
        if op_type == "credit":
            wallet_id = random.choice(wallet_ids)
            # Use integer amount to avoid float precision issues
            amount = random.randint(10, 500)
            response = requests.post(
                f"{API_BASE_URL}/wallets/{wallet_id}/credit",
                json={"amount": amount, "description": "Load test credit"},
                headers={"Idempotency-Key": gen_id("idem")},
                timeout=10
            )
            response.raise_for_status()
            return {"success": True, "type": "credit", "amount": amount}

        elif op_type == "debit":
            wallet_id = random.choice(wallet_ids)
            amount = random.randint(10, 200)
            response = requests.post(
                f"{API_BASE_URL}/wallets/{wallet_id}/debit",
                json={"amount": amount, "description": "Load test debit"},
                headers={"Idempotency-Key": gen_id("idem")},
                timeout=10
            )
            response.raise_for_status()
            return {"success": True, "type": "debit", "amount": amount}

        elif op_type == "transfer":
            if len(wallet_ids) < 2:
                return {"success": False, "type": "transfer", "error": "Not enough wallets"}
            
            from_wallet = random.choice(wallet_ids)
            to_wallet = random.choice([w for w in wallet_ids if w != from_wallet])
            amount = random.randint(10, 300)
            
            response = requests.post(
                f"{API_BASE_URL}/wallets/{from_wallet}/transfer",
                json={
                    "toWalletId": to_wallet,
                    "amount": amount,
                    "description": "Load test transfer"
                },
                headers={"Idempotency-Key": gen_id("idem")},
                timeout=10
            )
            response.raise_for_status()
            return {"success": True, "type": "transfer", "amount": amount}

    except Exception as e:
        write_cap(
            __import__('json').dumps({
                "timestamp": datetime.utcnow().isoformat(),
                "source": "loadtest",
                "type": "operation_error",
                "operation": op_type,
                "error": str(e),
            })
        )
        return {"success": False, "type": op_type, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Load test wallet operations")
    parser.add_argument("--wallets", type=int, default=100, help="Number of wallets to create")
    parser.add_argument("--operations", type=int, default=200, help="Number of random operations")
    parser.add_argument("--fast", action="store_true", help="Use parallel execution")
    parser.add_argument("--workers", type=int, default=10, help="Number of parallel workers")
    args = parser.parse_args()

    print("=" * 70)
    print("🚀 Quick Wallet Load Test")
    print("=" * 70)
    print(f"\n⚙️  Configuration:")
    print(f"   Wallets: {args.wallets}")
    print(f"   Operations: {args.operations}")
    print(f"   Mode: {'Parallel' if args.fast else 'Sequential'}")
    if args.fast:
        print(f"   Workers: {args.workers}")
    print()

    # Step 1: Create wallets
    print(f"📝 Creating {args.wallets} wallets...")
    start_time = time.time()

    if args.fast:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(create_wallet, i) for i in range(args.wallets)]
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                if result["success"]:
                    created_wallets.append(result["data"]["id"])
                    stats["wallets"]["success"] += 1
                else:
                    stats["wallets"]["failed"] += 1
                if i % 10 == 0 or i == args.wallets:
                    print(f"   Progress: {i}/{args.wallets} ({stats['wallets']['success']} ✓, {stats['wallets']['failed']} ✗)")
    else:
        for i in range(args.wallets):
            result = create_wallet(i)
            if result["success"]:
                created_wallets.append(result["data"]["id"])
                stats["wallets"]["success"] += 1
            else:
                stats["wallets"]["failed"] += 1
            if (i + 1) % 10 == 0 or (i + 1) == args.wallets:
                print(f"   Progress: {i+1}/{args.wallets} ({stats['wallets']['success']} ✓, {stats['wallets']['failed']} ✗)")
            time.sleep(0.05)

    create_duration = time.time() - start_time
    print(f"✅ Created {stats['wallets']['success']} wallets in {create_duration:.2f}s")
    print()

    if not created_wallets:
        print("❌ No wallets created. Exiting...")
        return

    # Step 2: Wait for async processing
    print("⏳ Waiting 5 seconds for async processing...")
    time.sleep(5)
    print()

    # Step 3: Perform operations
    print(f"🎲 Performing {args.operations} random operations...")
    start_time = time.time()

    operations = ["credit", "debit", "transfer"]
    
    if args.fast:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [
                executor.submit(perform_operation, random.choice(operations), created_wallets)
                for _ in range(args.operations)
            ]
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                if result["success"]:
                    stats[result["type"]]["success"] += 1
                else:
                    stats[result["type"]]["failed"] += 1
                if i % 20 == 0 or i == args.operations:
                    total_success = sum(s["success"] for s in stats.values())
                    print(f"   Progress: {i}/{args.operations} ({total_success} ✓)")
    else:
        for i in range(args.operations):
            op_type = random.choice(operations)
            result = perform_operation(op_type, created_wallets)
            if result["success"]:
                stats[result["type"]]["success"] += 1
            else:
                stats[result["type"]]["failed"] += 1
            if (i + 1) % 20 == 0 or (i + 1) == args.operations:
                total_success = sum(s["success"] for s in stats.values())
                print(f"   Progress: {i+1}/{args.operations} ({total_success} ✓)")
            time.sleep(0.05)

    ops_duration = time.time() - start_time
    print(f"✅ Completed operations in {ops_duration:.2f}s")
    print()

    # Step 4: Verify sample ledgers
    print("⏳ Waiting 5 seconds for final processing...")
    time.sleep(5)
    print()

    print("🔍 Checking ledger entries (sample)...")
    sample_size = min(5, len(created_wallets))
    sample_wallets = random.sample(created_wallets, sample_size)
    
    for wallet_id in sample_wallets:
        try:
            response = requests.get(f"{API_BASE_URL}/ledger/wallet/{wallet_id}", timeout=5)
            response.raise_for_status()
            ledger = response.json()
            print(f"   {wallet_id[:20]}...: {ledger.get('count', 0)} entries")
        except Exception as e:
            print(f"   {wallet_id[:20]}...: ❌ Error")

    print()

    # Final stats
    print("=" * 70)
    print("📊 Final Statistics")
    print("=" * 70)
    print(f"\n💼 Wallets:")
    print(f"   ✅ Success: {stats['wallets']['success']}")
    print(f"   ❌ Failed:  {stats['wallets']['failed']}")
    print(f"\n💰 Operations:")
    print(f"   Credit:   {stats['credit']['success']} ✓ / {stats['credit']['failed']} ✗")
    print(f"   Debit:    {stats['debit']['success']} ✓ / {stats['debit']['failed']} ✗")
    print(f"   Transfer: {stats['transfer']['success']} ✓ / {stats['transfer']['failed']} ✗")
    
    total_ops_success = sum(s["success"] for k, s in stats.items() if k != "wallets")
    total_ops_failed = sum(s["failed"] for k, s in stats.items() if k != "wallets")
    print(f"\n   Total: {total_ops_success} ✓ / {total_ops_failed} ✗")
    
    total_duration = create_duration + ops_duration
    print(f"\n⏱️  Total Duration: {total_duration:.2f}s")
    print(f"   Operations/sec: {total_ops_success / ops_duration:.2f}")
    print()
    print("=" * 70)
    print("✅ Load test complete!")
    print("=" * 70)


if __name__ == "__main__":
    main()

