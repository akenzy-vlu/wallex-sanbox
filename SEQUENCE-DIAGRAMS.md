# Wallex System - Complete Sequence Diagrams with Kafka

This document contains detailed sequence diagrams for all wallet operations in the Kafka-based event-driven architecture.

## Table of Contents
1. [Create Wallet Flow](#1-create-wallet-flow)
2. [Credit Wallet Flow](#2-credit-wallet-flow)
3. [Debit Wallet Flow](#3-debit-wallet-flow)
4. [Transfer Wallet Flow](#4-transfer-wallet-flow)

---

## 1. Create Wallet Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as WalletController
    participant Idem as IdempotencyService
    participant Handler as CreateWalletHandler
    participant Lock as DistributedLock (Redis)
    participant Agg as WalletAggregate
    participant ES as EventStore (KurrentDB)
    participant Persist as WalletRepository (PostgreSQL)
    participant Outbox as OutboxService (PostgreSQL)
    participant Publisher as KafkaOutboxPublisher
    participant Kafka as Kafka Broker
    participant LedgerConsumer as LedgerKafkaConsumer
    participant ReadModelConsumer as ReadModelKafkaConsumer
    participant LedgerDB as Ledger Entries (PostgreSQL)
    participant ReadModelDB as Read Model (PostgreSQL)

    Note over Client,ReadModelDB: CREATE WALLET FLOW

    %% Command Phase
    Client->>API: POST /wallets<br/>{walletId, ownerId, initialBalance}
    API->>Idem: checkIdempotency(idempotency-key)
    
    alt Already Processed
        Idem-->>API: Return cached response
        API-->>Client: 200 OK (cached)
    else New Request
        Idem-->>API: OK (not processed)
        
        API->>Handler: CreateWalletCommand
        Handler->>Lock: acquireLock(walletId)
        Lock-->>Handler: Lock acquired
        
        %% Aggregate Logic
        Handler->>Agg: create(walletId, ownerId, initialBalance)
        Agg->>Agg: validate business rules
        Agg->>Agg: generate WalletCreatedEvent
        Agg-->>Handler: WalletAggregate + events
        
        %% Persistence (Transaction)
        Handler->>Handler: Start Transaction
        
        %% 1. Save to Event Store
        Handler->>ES: appendToStream(walletId, [WalletCreatedEvent])
        ES->>ES: Store event immutably
        ES-->>Handler: eventId, version
        
        %% 2. Save to Write Model
        Handler->>Persist: save(WalletEntity)
        Persist->>Persist: INSERT wallet record
        Persist-->>Handler: saved
        
        %% 3. Enqueue to Outbox
        Handler->>Outbox: enqueue([WalletCreatedEvent], metadata)
        Outbox->>Outbox: INSERT into outbox table
        Outbox-->>Handler: queued
        
        Handler->>Handler: Commit Transaction
        Handler->>Lock: releaseLock(walletId)
        
        %% Cache result
        Handler->>Idem: saveResult(idempotency-key, response)
        Idem-->>Handler: cached
        
        Handler-->>API: WalletCreatedResponse
        API-->>Client: 201 Created
    end

    %% Async Processing Phase
    Note over Publisher,ReadModelDB: ASYNC EVENT PROCESSING (Every 5 seconds)

    %% Outbox Publisher
    loop Every 5 seconds
        Publisher->>Outbox: claimBatch(size: 100, consumer: 'kafka-publisher')
        Outbox->>Outbox: SELECT * FROM outbox<br/>WHERE not processed<br/>FOR UPDATE SKIP LOCKED
        Outbox-->>Publisher: batch[WalletCreatedEvent]
        
        alt Has Events
            Publisher->>Kafka: publish to 'wallet-events' topic<br/>key: walletId, partition by key
            Kafka->>Kafka: Persist to partition (durably)
            Kafka-->>Publisher: ack (all replicas)
            
            Publisher->>Outbox: markBatchProcessed(eventIds)
            Outbox->>Outbox: UPDATE outbox SET processed_at = NOW()
            Outbox-->>Publisher: marked
        end
    end

    %% Kafka Consumers
    Note over Kafka,ReadModelDB: PARALLEL CONSUMER PROCESSING

    %% Ledger Consumer
    Kafka->>LedgerConsumer: consume message (group: ledger-projector)
    LedgerConsumer->>LedgerConsumer: deserialize WalletCreatedEvent
    LedgerConsumer->>LedgerConsumer: check idempotency (checkpoint)
    
    alt Not Already Processed
        LedgerConsumer->>LedgerDB: INSERT ledger_entry<br/>{walletId, type: CREDIT,<br/>amount: initialBalance,<br/>balance: initialBalance}
        LedgerDB-->>LedgerConsumer: inserted
        
        LedgerConsumer->>LedgerConsumer: save checkpoint<br/>(eventId, version)
        LedgerConsumer->>Kafka: commit offset
    else Already Processed
        LedgerConsumer->>LedgerConsumer: skip (idempotent)
        LedgerConsumer->>Kafka: commit offset
    end

    %% Read Model Consumer
    Kafka->>ReadModelConsumer: consume message (group: read-model-projector)
    ReadModelConsumer->>ReadModelConsumer: deserialize WalletCreatedEvent
    ReadModelConsumer->>ReadModelConsumer: check idempotency (checkpoint)
    
    alt Not Already Processed
        ReadModelConsumer->>ReadModelDB: INSERT INTO wallets_read_model<br/>{walletId, ownerId,<br/>balance: initialBalance,<br/>status: ACTIVE}
        ReadModelDB-->>ReadModelConsumer: inserted
        
        ReadModelConsumer->>ReadModelConsumer: save checkpoint<br/>(eventId, version)
        ReadModelConsumer->>Kafka: commit offset
    else Already Processed
        ReadModelConsumer->>ReadModelConsumer: skip (idempotent)
        ReadModelConsumer->>Kafka: commit offset
    end

    Note over Client,ReadModelDB: WALLET CREATED SUCCESSFULLY ✅<br/>Event Sourced, Persisted, and Projected
```

### Create Wallet Flow Description

**Synchronous Phase (Client Request):**
1. Client sends POST request with wallet details
2. Idempotency check prevents duplicate processing
3. Distributed lock acquired for wallet
4. Wallet aggregate validates and generates event
5. **Transaction commits atomically**:
   - Event saved to KurrentDB (event store)
   - Wallet entity saved to PostgreSQL (write model)
   - Event enqueued to outbox table
6. Response returned to client (201 Created)

**Asynchronous Phase (Event Processing):**
7. Kafka publisher polls outbox every 5 seconds
8. Events published to Kafka topic with wallet partition key
9. **Two parallel consumers process independently**:
   - **Ledger Consumer**: Creates ledger entry with initial balance
   - **Read Model Consumer**: Creates read model record
10. Each consumer maintains its own checkpoint for idempotency

---

## 2. Credit Wallet Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as WalletController
    participant Idem as IdempotencyService
    participant Handler as CreditWalletHandler
    participant Lock as DistributedLock (Redis)
    participant Repo as WalletRepository
    participant Agg as WalletAggregate
    participant ES as EventStore (KurrentDB)
    participant Persist as WalletRepository (PostgreSQL)
    participant Outbox as OutboxService (PostgreSQL)
    participant Publisher as KafkaOutboxPublisher
    participant Kafka as Kafka Broker
    participant LedgerConsumer as LedgerKafkaConsumer
    participant ReadModelConsumer as ReadModelKafkaConsumer
    participant LedgerDB as Ledger Entries (PostgreSQL)
    participant ReadModelDB as Read Model (PostgreSQL)

    Note over Client,ReadModelDB: CREDIT WALLET FLOW

    %% Command Phase
    Client->>API: POST /wallets/{walletId}/credit<br/>{amount, description}
    API->>Idem: checkIdempotency(idempotency-key)
    
    alt Already Processed
        Idem-->>API: Return cached response
        API-->>Client: 200 OK (cached)
    else New Request
        Idem-->>API: OK (not processed)
        
        API->>Handler: CreditWalletCommand
        Handler->>Lock: acquireLock(walletId)
        Lock-->>Handler: Lock acquired
        
        %% Load Aggregate
        Handler->>Repo: findById(walletId)
        Repo->>ES: readStream(walletId)
        ES-->>Repo: [events]
        Repo->>Agg: rehydrate from events
        Agg-->>Repo: WalletAggregate (current state)
        Repo-->>Handler: WalletAggregate
        
        %% Business Logic
        Handler->>Agg: credit(amount, description)
        Agg->>Agg: validate amount > 0
        Agg->>Agg: calculate new balance
        Agg->>Agg: generate WalletCreditedEvent
        Agg-->>Handler: WalletAggregate + events
        
        %% Persistence (Transaction)
        Handler->>Handler: Start Transaction
        
        %% 1. Append to Event Store
        Handler->>ES: appendToStream(walletId, [WalletCreditedEvent])
        ES->>ES: Store event with version check
        ES-->>Handler: eventId, version
        
        %% 2. Update Write Model
        Handler->>Persist: update(WalletEntity)<br/>SET balance = balance + amount
        Persist->>Persist: UPDATE wallet<br/>WHERE id = walletId AND version = old_version
        Persist-->>Handler: updated
        
        %% 3. Enqueue to Outbox
        Handler->>Outbox: enqueue([WalletCreditedEvent], metadata)
        Outbox->>Outbox: INSERT into outbox
        Outbox-->>Handler: queued
        
        Handler->>Handler: Commit Transaction
        Handler->>Lock: releaseLock(walletId)
        
        Handler->>Idem: saveResult(idempotency-key, response)
        Handler-->>API: WalletCreditedResponse
        API-->>Client: 200 OK {newBalance}
    end

    %% Async Processing Phase
    Note over Publisher,ReadModelDB: ASYNC EVENT PROCESSING

    %% Outbox to Kafka
    Publisher->>Outbox: claimBatch(100)
    Outbox-->>Publisher: [WalletCreditedEvent]
    
    Publisher->>Kafka: publish(wallet-events, key: walletId)
    Kafka->>Kafka: Append to partition (ordered by walletId)
    Kafka-->>Publisher: ack
    
    Publisher->>Outbox: markBatchProcessed()
    
    %% Parallel Consumers
    
    %% Ledger Consumer
    Kafka->>LedgerConsumer: consume WalletCreditedEvent
    LedgerConsumer->>LedgerConsumer: check idempotency
    
    LedgerConsumer->>LedgerDB: INSERT ledger_entry<br/>{walletId, type: CREDIT,<br/>amount: credited_amount,<br/>balance: new_balance,<br/>description: description}
    LedgerDB-->>LedgerConsumer: inserted
    
    LedgerConsumer->>LedgerConsumer: save checkpoint
    LedgerConsumer->>Kafka: commit offset
    
    %% Read Model Consumer
    Kafka->>ReadModelConsumer: consume WalletCreditedEvent
    ReadModelConsumer->>ReadModelConsumer: check idempotency
    
    ReadModelConsumer->>ReadModelDB: UPDATE wallets_read_model<br/>SET balance = new_balance,<br/>version = new_version<br/>WHERE walletId = walletId
    ReadModelDB-->>ReadModelConsumer: updated
    
    ReadModelConsumer->>ReadModelConsumer: save checkpoint
    ReadModelConsumer->>Kafka: commit offset

    Note over Client,ReadModelDB: WALLET CREDITED SUCCESSFULLY ✅<br/>Ledger Entry Created, Balance Updated
```

### Credit Wallet Flow Description

**Synchronous Phase:**
1. Client sends credit request with amount
2. Idempotency check prevents duplicate credits
3. Lock acquired to prevent concurrent modifications
4. **Aggregate rehydration**: Load all events from event store
5. Business rule validation (amount > 0)
6. **Atomic transaction**:
   - Append WalletCreditedEvent to event store
   - Update balance in write model
   - Enqueue event to outbox
7. Return updated balance to client

**Asynchronous Phase:**
8. Event published to Kafka with wallet partition key
9. **Ledger Consumer**: Creates CREDIT entry in ledger
10. **Read Model Consumer**: Updates wallet balance in read model
11. Both consumers ensure idempotency with checkpoints

---

## 3. Debit Wallet Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as WalletController
    participant Idem as IdempotencyService
    participant Handler as DebitWalletHandler
    participant Lock as DistributedLock (Redis)
    participant Repo as WalletRepository
    participant Agg as WalletAggregate
    participant ES as EventStore (KurrentDB)
    participant Persist as WalletRepository (PostgreSQL)
    participant Outbox as OutboxService (PostgreSQL)
    participant Publisher as KafkaOutboxPublisher
    participant Kafka as Kafka Broker
    participant LedgerConsumer as LedgerKafkaConsumer
    participant ReadModelConsumer as ReadModelKafkaConsumer
    participant LedgerDB as Ledger Entries (PostgreSQL)
    participant ReadModelDB as Read Model (PostgreSQL)

    Note over Client,ReadModelDB: DEBIT WALLET FLOW

    %% Command Phase
    Client->>API: POST /wallets/{walletId}/debit<br/>{amount, description}
    API->>Idem: checkIdempotency(idempotency-key)
    
    alt Already Processed
        Idem-->>API: Return cached response
        API-->>Client: 200 OK (cached)
    else New Request
        Idem-->>API: OK (not processed)
        
        API->>Handler: DebitWalletCommand
        Handler->>Lock: acquireLock(walletId)
        Lock-->>Handler: Lock acquired
        
        %% Load Aggregate
        Handler->>Repo: findById(walletId)
        Repo->>ES: readStream(walletId)
        ES-->>Repo: [events]
        Repo->>Agg: rehydrate from events
        Agg-->>Handler: WalletAggregate (current state)
        
        %% Business Logic with Validation
        Handler->>Agg: debit(amount, description)
        Agg->>Agg: validate amount > 0
        Agg->>Agg: check sufficient balance
        
        alt Insufficient Funds
            Agg-->>Handler: InsufficientFundsError
            Handler->>Lock: releaseLock(walletId)
            Handler-->>API: 400 Bad Request
            API-->>Client: 400 Insufficient Funds ❌
        else Sufficient Funds
            Agg->>Agg: calculate new balance
            Agg->>Agg: generate WalletDebitedEvent
            Agg-->>Handler: WalletAggregate + events
            
            %% Persistence (Transaction)
            Handler->>Handler: Start Transaction
            
            %% 1. Append to Event Store
            Handler->>ES: appendToStream(walletId, [WalletDebitedEvent])
            ES->>ES: Store event with version check
            ES-->>Handler: eventId, version
            
            %% 2. Update Write Model
            Handler->>Persist: update(WalletEntity)<br/>SET balance = balance - amount
            Persist->>Persist: UPDATE wallet<br/>WHERE id = walletId<br/>AND balance >= amount (optimistic lock)
            Persist-->>Handler: updated
            
            %% 3. Enqueue to Outbox
            Handler->>Outbox: enqueue([WalletDebitedEvent], metadata)
            Outbox->>Outbox: INSERT into outbox
            Outbox-->>Handler: queued
            
            Handler->>Handler: Commit Transaction
            Handler->>Lock: releaseLock(walletId)
            
            Handler->>Idem: saveResult(idempotency-key, response)
            Handler-->>API: WalletDebitedResponse
            API-->>Client: 200 OK {newBalance}
        end
    end

    %% Async Processing Phase
    Note over Publisher,ReadModelDB: ASYNC EVENT PROCESSING

    %% Outbox to Kafka
    Publisher->>Outbox: claimBatch(100)
    Outbox-->>Publisher: [WalletDebitedEvent]
    
    Publisher->>Kafka: publish(wallet-events, key: walletId)
    Kafka->>Kafka: Append to partition (ordered)
    Kafka-->>Publisher: ack
    
    Publisher->>Outbox: markBatchProcessed()
    
    %% Parallel Consumers
    
    %% Ledger Consumer
    Kafka->>LedgerConsumer: consume WalletDebitedEvent
    LedgerConsumer->>LedgerConsumer: check idempotency
    
    LedgerConsumer->>LedgerDB: INSERT ledger_entry<br/>{walletId, type: DEBIT,<br/>amount: debited_amount,<br/>balance: new_balance,<br/>description: description}
    LedgerDB-->>LedgerConsumer: inserted
    
    LedgerConsumer->>LedgerConsumer: save checkpoint
    LedgerConsumer->>Kafka: commit offset
    
    %% Read Model Consumer
    Kafka->>ReadModelConsumer: consume WalletDebitedEvent
    ReadModelConsumer->>ReadModelConsumer: check idempotency
    
    ReadModelConsumer->>ReadModelDB: UPDATE wallets_read_model<br/>SET balance = new_balance,<br/>version = new_version<br/>WHERE walletId = walletId
    ReadModelDB-->>ReadModelConsumer: updated
    
    ReadModelConsumer->>ReadModelConsumer: save checkpoint
    ReadModelConsumer->>Kafka: commit offset

    Note over Client,ReadModelDB: WALLET DEBITED SUCCESSFULLY ✅<br/>Balance Deducted, Ledger Updated
```

### Debit Wallet Flow Description

**Synchronous Phase:**
1. Client sends debit request with amount
2. Idempotency check prevents duplicate debits
3. Lock acquired for wallet
4. Aggregate rehydrated from event store
5. **Critical validation**: Check sufficient balance
   - If insufficient: Return 400 error immediately
   - If sufficient: Proceed with debit
6. **Atomic transaction**:
   - Append WalletDebitedEvent to event store
   - Decrease balance in write model with optimistic lock
   - Enqueue event to outbox
7. Return new balance to client

**Asynchronous Phase:**
8. Event published to Kafka
9. **Ledger Consumer**: Creates DEBIT entry
10. **Read Model Consumer**: Updates balance
11. Idempotency ensures no duplicate processing

---

## 4. Transfer Wallet Flow

```mermaid
sequenceDiagram
    participant Client
    participant API as WalletController
    participant Idem as IdempotencyService
    participant Handler as TransferWalletHandler
    participant Lock as DistributedLock (Redis)
    participant Repo as WalletRepository
    participant FromAgg as FromWallet Aggregate
    participant ToAgg as ToWallet Aggregate
    participant ES as EventStore (KurrentDB)
    participant Persist as WalletRepository (PostgreSQL)
    participant Outbox as OutboxService (PostgreSQL)
    participant Publisher as KafkaOutboxPublisher
    participant Kafka as Kafka Broker
    participant LedgerConsumer as LedgerKafkaConsumer
    participant ReadModelConsumer as ReadModelKafkaConsumer
    participant LedgerDB as Ledger Entries (PostgreSQL)
    participant ReadModelDB as Read Model (PostgreSQL)

    Note over Client,ReadModelDB: TRANSFER WALLET FLOW (2-Phase)

    %% Command Phase
    Client->>API: POST /wallets/{fromWalletId}/transfer<br/>{toWalletId, amount, description}
    API->>Idem: checkIdempotency(idempotency-key)
    
    alt Already Processed
        Idem-->>API: Return cached response
        API-->>Client: 200 OK (cached)
    else New Request
        Idem-->>API: OK (not processed)
        
        API->>Handler: TransferWalletCommand
        
        %% Acquire locks in order (prevent deadlock)
        Handler->>Handler: sort walletIds alphabetically
        Handler->>Lock: acquireLock(fromWalletId)
        Lock-->>Handler: Lock 1 acquired
        Handler->>Lock: acquireLock(toWalletId)
        Lock-->>Handler: Lock 2 acquired
        
        Note over Handler,ES: PHASE 1: INITIATE TRANSFER (Debit Source)
        
        %% Load Source Wallet
        Handler->>Repo: findById(fromWalletId)
        Repo->>ES: readStream(fromWalletId)
        ES-->>Repo: [events]
        Repo->>FromAgg: rehydrate
        Repo-->>Handler: FromWallet Aggregate
        
        %% Validate and Initiate
        Handler->>FromAgg: initiateTransfer(toWalletId, amount)
        FromAgg->>FromAgg: validate amount > 0
        FromAgg->>FromAgg: check sufficient balance
        
        alt Insufficient Funds
            FromAgg-->>Handler: InsufficientFundsError
            Handler->>Lock: releaseLocks(both)
            Handler-->>API: 400 Bad Request
            API-->>Client: 400 Insufficient Funds ❌
        else Sufficient Funds
            FromAgg->>FromAgg: calculate new balance (debit)
            FromAgg->>FromAgg: generate WalletTransferInitiatedEvent
            FromAgg-->>Handler: FromAggregate + events
            
            %% Load Destination Wallet
            Handler->>Repo: findById(toWalletId)
            Repo->>ES: readStream(toWalletId)
            ES-->>Repo: [events]
            Repo->>ToAgg: rehydrate
            Repo-->>Handler: ToWallet Aggregate
            
            Note over Handler,ES: PHASE 2: COMPLETE TRANSFER (Credit Destination)
            
            %% Complete Transfer
            Handler->>ToAgg: completeTransfer(fromWalletId, amount)
            ToAgg->>ToAgg: validate amount > 0
            ToAgg->>ToAgg: calculate new balance (credit)
            ToAgg->>ToAgg: generate WalletTransferCompletedEvent
            ToAgg-->>Handler: ToAggregate + events
            
            %% Atomic Transaction (Both Wallets)
            Handler->>Handler: Start Transaction
            
            %% 1. Append events to Event Store
            Handler->>ES: appendToStream(fromWalletId,<br/>[WalletTransferInitiatedEvent])
            ES-->>Handler: eventId1, version1
            
            Handler->>ES: appendToStream(toWalletId,<br/>[WalletTransferCompletedEvent])
            ES-->>Handler: eventId2, version2
            
            %% 2. Update both wallets in Write Model
            Handler->>Persist: update(FromWallet)<br/>SET balance = balance - amount
            Persist-->>Handler: updated
            
            Handler->>Persist: update(ToWallet)<br/>SET balance = balance + amount
            Persist-->>Handler: updated
            
            %% 3. Enqueue both events to Outbox
            Handler->>Outbox: enqueue([<br/>  WalletTransferInitiatedEvent,<br/>  WalletTransferCompletedEvent<br/>], metadata)
            Outbox->>Outbox: INSERT 2 events to outbox
            Outbox-->>Handler: queued
            
            Handler->>Handler: Commit Transaction
            Handler->>Lock: releaseLocks(both)
            
            Handler->>Idem: saveResult(idempotency-key, response)
            Handler-->>API: TransferCompletedResponse
            API-->>Client: 200 OK {fromBalance, toBalance}
        end
    end

    %% Async Processing Phase
    Note over Publisher,ReadModelDB: ASYNC EVENT PROCESSING (2 Events)

    %% Outbox to Kafka
    Publisher->>Outbox: claimBatch(100)
    Outbox-->>Publisher: [<br/>  WalletTransferInitiatedEvent,<br/>  WalletTransferCompletedEvent<br/>]
    
    Publisher->>Kafka: publish 2 events to 'wallet-events'<br/>(different partition keys)
    Kafka->>Kafka: Event 1 → partition(fromWalletId)
    Kafka->>Kafka: Event 2 → partition(toWalletId)
    Kafka-->>Publisher: ack (both)
    
    Publisher->>Outbox: markBatchProcessed()
    
    %% Parallel Consumer Processing
    Note over Kafka,ReadModelDB: BOTH EVENTS PROCESSED IN PARALLEL

    %% Event 1: Transfer Initiated (Debit)
    Kafka->>LedgerConsumer: consume WalletTransferInitiatedEvent
    LedgerConsumer->>LedgerConsumer: check idempotency
    
    LedgerConsumer->>LedgerDB: INSERT ledger_entry<br/>{walletId: fromWalletId,<br/>type: DEBIT,<br/>amount: transfer_amount,<br/>balance: new_from_balance,<br/>description: 'Transfer to {toWalletId}'}
    LedgerDB-->>LedgerConsumer: inserted
    
    LedgerConsumer->>LedgerConsumer: save checkpoint
    LedgerConsumer->>Kafka: commit offset
    
    %% Event 1: Read Model Update (From Wallet)
    Kafka->>ReadModelConsumer: consume WalletTransferInitiatedEvent
    ReadModelConsumer->>ReadModelConsumer: check idempotency
    
    ReadModelConsumer->>ReadModelDB: UPDATE wallets_read_model<br/>SET balance = new_from_balance<br/>WHERE walletId = fromWalletId
    ReadModelDB-->>ReadModelConsumer: updated
    
    ReadModelConsumer->>ReadModelConsumer: save checkpoint
    ReadModelConsumer->>Kafka: commit offset
    
    %% Event 2: Transfer Completed (Credit)
    Kafka->>LedgerConsumer: consume WalletTransferCompletedEvent
    LedgerConsumer->>LedgerConsumer: check idempotency
    
    LedgerConsumer->>LedgerDB: INSERT ledger_entry<br/>{walletId: toWalletId,<br/>type: CREDIT,<br/>amount: transfer_amount,<br/>balance: new_to_balance,<br/>description: 'Transfer from {fromWalletId}'}
    LedgerDB-->>LedgerConsumer: inserted
    
    LedgerConsumer->>LedgerConsumer: save checkpoint
    LedgerConsumer->>Kafka: commit offset
    
    %% Event 2: Read Model Update (To Wallet)
    Kafka->>ReadModelConsumer: consume WalletTransferCompletedEvent
    ReadModelConsumer->>ReadModelConsumer: check idempotency
    
    ReadModelConsumer->>ReadModelDB: UPDATE wallets_read_model<br/>SET balance = new_to_balance<br/>WHERE walletId = toWalletId
    ReadModelDB-->>ReadModelConsumer: updated
    
    ReadModelConsumer->>ReadModelConsumer: save checkpoint
    ReadModelConsumer->>Kafka: commit offset

    Note over Client,ReadModelDB: TRANSFER COMPLETED SUCCESSFULLY ✅<br/>Both Wallets Updated, 2 Ledger Entries Created
```

### Transfer Wallet Flow Description

**Synchronous Phase (2-Phase Transfer):**
1. Client sends transfer request with source, destination, amount
2. Idempotency check prevents duplicate transfers
3. **Deadlock prevention**: Lock both wallets in sorted order
4. **Phase 1 - Initiate Transfer**:
   - Load source wallet aggregate
   - Validate sufficient balance
   - Generate WalletTransferInitiatedEvent (debit)
5. **Phase 2 - Complete Transfer**:
   - Load destination wallet aggregate
   - Generate WalletTransferCompletedEvent (credit)
6. **Atomic transaction** (both wallets):
   - Append 2 events to event store (different streams)
   - Update both wallet balances in write model
   - Enqueue both events to outbox
7. Release both locks
8. Return both new balances to client

**Asynchronous Phase (2 Events):**
9. Publisher publishes both events to Kafka
   - Event 1 → partition based on fromWalletId
   - Event 2 → partition based on toWalletId
10. **Ledger Consumer** processes both events:
    - Creates DEBIT entry for source wallet
    - Creates CREDIT entry for destination wallet
11. **Read Model Consumer** processes both events:
    - Updates source wallet balance
    - Updates destination wallet balance
12. All operations are idempotent and can be replayed

---

## System Architecture Overview

### Key Components

| Component          | Technology   | Purpose                                  |
| ------------------ | ------------ | ---------------------------------------- |
| **Event Store**    | KurrentDB    | Single source of truth, immutable events |
| **Message Broker** | Apache Kafka | Reliable event distribution, ordering    |
| **Write Model**    | PostgreSQL   | Current state for commands               |
| **Read Model**     | PostgreSQL   | Optimized for queries                    |
| **Ledger**         | PostgreSQL   | Audit trail, transaction history         |
| **Outbox**         | PostgreSQL   | Transactional outbox pattern             |
| **Cache**          | Redis        | Idempotency, distributed locks           |

### Event Flow Guarantees

✅ **Atomicity**: All or nothing (transaction boundary)
✅ **Consistency**: Business rules enforced in aggregates
✅ **Isolation**: Distributed locks prevent concurrent modifications
✅ **Durability**: Events persisted to event store + Kafka
✅ **Ordering**: Events for same wallet always in order (partition key)
✅ **Idempotency**: No duplicate processing (checkpoints)
✅ **Reliability**: At-least-once delivery with Kafka
✅ **Scalability**: 10 Kafka partitions, parallel consumers

### Error Handling

- **Insufficient Funds**: Validated in aggregate, returns 400
- **Duplicate Request**: Idempotency key returns cached response
- **Concurrent Modification**: Optimistic locking + version check
- **Event Processing Failure**: Automatic retry with exponential backoff
- **Dead Letter Queue**: Failed messages sent to DLQ after max retries
- **System Crash**: Events replayed from Kafka on recovery

---

## Performance Characteristics

### Synchronous Operations (Command Side)

- **Create Wallet**: ~50-100ms
- **Credit/Debit**: ~50-100ms
- **Transfer**: ~100-150ms (2 wallets)

### Asynchronous Processing (Event Side)

- **Outbox to Kafka**: ~5 seconds (polling interval)
- **Kafka to Consumers**: ~10-100ms (near real-time)
- **Total Eventual Consistency**: ~5-10 seconds

### Throughput

- **Commands**: ~200-300 ops/second
- **Events Published**: ~100-200 events/second
- **Events Consumed**: ~500-1000 events/second (parallel)

### Scalability

- **Horizontal Scaling**: Add more consumer instances
- **Partition Count**: 10 partitions = up to 10 parallel consumers
- **Load Distribution**: Automatic via Kafka consumer groups

---

## Monitoring Points

### Health Checks

```bash
# Overall system health
curl http://localhost:3000/health/kafka

# Kafka producer health
curl http://localhost:3000/health/kafka/stats
```

### Key Metrics to Monitor

1. **Command Processing Time** (p50, p95, p99)
2. **Outbox Lag** (age of oldest unprocessed event)
3. **Kafka Consumer Lag** (per partition, per consumer group)
4. **Event Processing Time** (per consumer)
5. **Error Rate** (per operation type)
6. **Throughput** (ops/second)

### Kafka UI

Access http://localhost:8080 to monitor:
- Topics and partitions
- Consumer groups and lag
- Message flow and throughput
- Partition distribution

---

## Best Practices

### For High Reliability

1. ✅ Always use idempotency keys
2. ✅ Validate in aggregates before persistence
3. ✅ Use distributed locks for concurrent operations
4. ✅ Monitor consumer lag
5. ✅ Set up alerts for high lag (> 1000 messages)

### For High Performance

1. ✅ Batch event publishing (100 events/batch)
2. ✅ Use appropriate partition count (10 partitions)
3. ✅ Tune consumer batch sizes
4. ✅ Enable compression (GZIP)
5. ✅ Optimize database queries

### For Scalability

1. ✅ Add more consumer instances (horizontal scaling)
2. ✅ Increase partition count for topics
3. ✅ Use read models for queries (CQRS)
4. ✅ Cache frequently accessed data
5. ✅ Separate read and write workloads

---

**Status:** ✅ Production Ready | **Version:** 1.0.0 | **Date:** October 29, 2025

