# Diagram Flow Tạo Tài Khoản Wallet

## 🎯 Tổng Quan

Hệ thống sử dụng kiến trúc **Event Sourcing + CQRS** để quản lý wallet. Khi tạo một wallet mới, hệ thống sẽ trải qua **10 bước chính** với sự tham gia của nhiều component khác nhau.

---

## 📊 Sequence Diagram - Flow Chi Tiết

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant WalletController
    participant CommandBus
    participant CreateWalletHandler
    participant DistributedLock
    participant WalletAggregate
    participant EventStore
    participant WalletRepository as PostgreSQL<br/>(Wallet Table)
    participant WalletProjection as Read Model<br/>(Projection)
    participant LedgerProjection as Ledger<br/>(Ledger Entries)
    participant QueryBus
    
    Client->>WalletController: POST /wallets<br/>{walletId, ownerId, initialBalance}
    
    Note over WalletController: Validate request<br/>(walletId & ownerId required)
    
    WalletController->>CommandBus: Execute CreateWalletCommand
    CommandBus->>CreateWalletHandler: Handle command
    
    Note over CreateWalletHandler: 🔒 Acquire distributed lock
    CreateWalletHandler->>DistributedLock: Lock("lock:wallet:{walletId}", 5s)
    DistributedLock-->>CreateWalletHandler: Lock acquired
    
    Note over CreateWalletHandler: Check existence in Event Store
    CreateWalletHandler->>EventStore: readStream(walletId)
    EventStore-->>CreateWalletHandler: [] (empty - wallet not exists)
    
    Note over CreateWalletHandler: Check existence in PostgreSQL
    CreateWalletHandler->>WalletRepository: findById(walletId)
    WalletRepository-->>CreateWalletHandler: null (wallet not exists)
    
    Note over CreateWalletHandler: Create aggregate & generate events
    CreateWalletHandler->>WalletAggregate: WalletAggregate.create()
    
    Note over WalletAggregate: Generate domain events:<br/>1. WalletCreated<br/>2. WalletCredited (if initialBalance > 0)
    WalletAggregate-->>CreateWalletHandler: Aggregate with pending events
    
    Note over CreateWalletHandler: 📝 Persist events to Event Store
    CreateWalletHandler->>EventStore: appendToStream(walletId, events, version)
    EventStore-->>CreateWalletHandler: Committed events with metadata
    
    Note over CreateWalletHandler: 💾 Persist to PostgreSQL
    CreateWalletHandler->>WalletRepository: create(walletId, ownerId, balance)
    WalletRepository-->>CreateWalletHandler: ✅ Wallet persisted
    
    Note over CreateWalletHandler: 📊 Project to Read Model
    CreateWalletHandler->>WalletProjection: project(committedEvents)
    WalletProjection-->>CreateWalletHandler: ✅ Read model updated
    
    Note over CreateWalletHandler: 📒 Project to Ledger
    CreateWalletHandler->>LedgerProjection: project(committedEvents)
    LedgerProjection-->>CreateWalletHandler: ✅ Ledger entries created
    
    Note over CreateWalletHandler: Mark events as committed
    CreateWalletHandler->>WalletAggregate: markEventsCommitted()
    
    CreateWalletHandler->>DistributedLock: Release lock
    CreateWalletHandler-->>CommandBus: Wallet snapshot
    CommandBus-->>WalletController: Success
    
    Note over WalletController: Query wallet from Read Model
    WalletController->>QueryBus: Execute GetWalletQuery(walletId)
    QueryBus->>WalletProjection: Find wallet in read model
    WalletProjection-->>QueryBus: WalletReadModel
    QueryBus-->>WalletController: Wallet data
    
    WalletController-->>Client: 200 OK<br/>WalletReadModel
```

---

## 🔄 Flow Chart - Luồng Xử Lý

```mermaid
flowchart TD
    Start([Client Request]) --> Validate{Validate Input}
    Validate -->|Invalid| Error1[❌ BadRequestException]
    Validate -->|Valid| CreateCmd[Create Command]
    
    CreateCmd --> AcquireLock[🔒 Acquire Distributed Lock]
    AcquireLock -->|Timeout| Error2[❌ Lock Timeout]
    AcquireLock -->|Success| CheckES{Check Event Store}
    
    CheckES -->|Exists| Error3[❌ WalletAlreadyExistsError]
    CheckES -->|Not exists| CheckDB{Check PostgreSQL}
    
    CheckDB -->|Exists| Error3
    CheckDB -->|Not exists| CreateAgg[Create Wallet Aggregate]
    
    CreateAgg --> GenEvents[Generate Domain Events:<br/>- WalletCreated<br/>- WalletCredited if balance > 0]
    
    GenEvents --> AppendES[📝 Append to Event Store]
    AppendES -->|Failed| Error4[❌ Event Store Error]
    AppendES -->|Success| PersistDB[💾 Persist to PostgreSQL]
    
    PersistDB -->|Failed| Error5[❌ Persistence Error<br/>Events already in ES!]
    PersistDB -->|Success| ProjectRM[📊 Project to Read Model]
    
    ProjectRM -->|Failed| Error6[❌ Projection Error]
    ProjectRM -->|Success| ProjectLedger[📒 Project to Ledger]
    
    ProjectLedger --> MarkCommit[✅ Mark Events Committed]
    MarkCommit --> ReleaseLock[🔓 Release Lock]
    ReleaseLock --> QueryRM[Query Read Model]
    QueryRM --> Return[✅ Return Wallet Data]
    
    Return --> End([Success Response])
    
    Error1 --> End2([Error Response])
    Error2 --> End2
    Error3 --> End2
    Error4 --> End2
    Error5 --> End2
    Error6 --> End2
```

---

## 🏗️ Architecture Components Diagram

```mermaid
graph TB
    subgraph "API Layer"
        Controller[WalletController]
    end
    
    subgraph "Application Layer - CQRS"
        CommandBus[Command Bus]
        QueryBus[Query Bus]
        CreateHandler[CreateWalletHandler]
        GetWalletQuery[GetWalletQuery]
    end
    
    subgraph "Domain Layer"
        Aggregate[WalletAggregate]
        Events[Domain Events:<br/>WalletCreated<br/>WalletCredited<br/>WalletDebited]
    end
    
    subgraph "Infrastructure Layer"
        Lock[Distributed Lock<br/>Redis]
        EventStore[Event Store<br/>KurrentDB/EventStoreDB]
        PostgreSQL[(PostgreSQL<br/>Wallet Table)]
        ReadModel[(Read Model<br/>Wallet Projection)]
        Ledger[(Ledger<br/>Ledger Entries)]
    end
    
    Controller -->|1. POST /wallets| CommandBus
    CommandBus -->|2. Dispatch| CreateHandler
    CreateHandler -->|3. Lock| Lock
    CreateHandler -->|4. Check| EventStore
    CreateHandler -->|5. Check| PostgreSQL
    CreateHandler -->|6. Create| Aggregate
    Aggregate -->|7. Generate| Events
    CreateHandler -->|8. Append| EventStore
    CreateHandler -->|9. Persist| PostgreSQL
    CreateHandler -->|10. Project| ReadModel
    CreateHandler -->|11. Project| Ledger
    Controller -->|12. Query| QueryBus
    QueryBus -->|13. Read| ReadModel
    ReadModel -->|14. Return| Controller
    
    style Controller fill:#e1f5ff
    style Aggregate fill:#fff4e1
    style EventStore fill:#e8f5e9
    style PostgreSQL fill:#f3e5f5
    style ReadModel fill:#fff3e0
    style Ledger fill:#fce4ec
```

---

## 📝 Chi Tiết 10 Bước Xử Lý

### **Bước 1: Client Request**
- Client gửi POST request đến `/wallets`
- Body: `{ walletId, ownerId, initialBalance? }`
- Controller validate input (walletId và ownerId bắt buộc)

### **Bước 2: Create Command**
- Tạo `CreateWalletCommand` với walletId, ownerId, initialBalance (default = 0)
- CommandBus dispatch command đến Handler

### **Bước 3: Acquire Distributed Lock** 🔒
- Sử dụng Redis distributed lock
- Lock key: `lock:wallet:{walletId}`
- TTL: 5 giây
- Mục đích: Đảm bảo không có 2 request tạo cùng 1 wallet đồng thời

### **Bước 4: Check Event Store**
- Đọc event stream từ Event Store (KurrentDB)
- Nếu có events → Wallet đã tồn tại → Throw `WalletAlreadyExistsError`
- Event Store là **source of truth**

### **Bước 5: Check PostgreSQL**
- Kiểm tra wallet có tồn tại trong database không
- Double check để đảm bảo consistency
- Nếu tồn tại → Throw `WalletAlreadyExistsError`

### **Bước 6: Create Aggregate**
- Tạo `WalletAggregate` mới
- Validate initialBalance >= 0
- Aggregate là nơi chứa business logic

### **Bước 7: Generate Domain Events**
- **Event 1**: `WalletCreated` - Luôn được tạo
  - Data: `{ ownerId, initialBalance }`
- **Event 2**: `WalletCredited` - Chỉ tạo nếu initialBalance > 0
  - Data: `{ amount: initialBalance, description: "Initial balance" }`

### **Bước 8: Append to Event Store** 📝
- Lưu events vào Event Store với version control
- Events được append với metadata:
  - version
  - occurredAt (timestamp)
  - correlationId, causationId
- **Quan trọng**: Đây là điểm không thể rollback!

### **Bước 9: Persist to PostgreSQL** 💾
- Insert wallet vào bảng `wallets`
- Columns: id, owner_id, balance, created_at, updated_at
- Nếu fail: Log error nhưng events đã ở Event Store (source of truth)

### **Bước 10a: Project to Read Model** 📊
- Cập nhật Read Model (optimized for queries)
- Read Model là denormalized data
- Dùng cho các query GET /wallets

### **Bước 10b: Project to Ledger** 📒
- Tạo ledger entries từ events
- Tracking balance before/after
- Audit trail cho mọi thay đổi

---

## 🔑 Key Concepts

### **Event Sourcing**
- Events là single source of truth
- Mọi thay đổi đều được lưu dưới dạng events
- Có thể rebuild state từ events

### **CQRS (Command Query Responsibility Segregation)**
- **Write Side**: Commands → Aggregate → Events → Event Store
- **Read Side**: Queries → Read Model (optimized)
- Tách biệt logic write và read

### **Distributed Lock**
- Đảm bảo consistency trong môi trường distributed
- Tránh race condition khi tạo wallet
- TTL ngắn (5s) để tránh deadlock

### **Eventual Consistency**
- Event Store write thành công → Success
- Projections (Read Model, Ledger) có thể failed
- Hệ thống eventually consistent

---

## 🛡️ Error Handling

| Error Type                 | HTTP Status | Khi Nào Xảy Ra                           |
| -------------------------- | ----------- | ---------------------------------------- |
| `BadRequestException`      | 400         | Missing walletId/ownerId, invalid amount |
| `WalletAlreadyExistsError` | 409         | Wallet đã tồn tại                        |
| `EventConcurrencyError`    | 409         | Version conflict                         |
| `NotFoundException`        | 404         | Query wallet không tồn tại               |

---

## 📊 Data Flow

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Client    │────────>│ WalletCtrl   │────────>│ CommandBus  │
└─────────────┘         └──────────────┘         └─────────────┘
                                                         │
                                                         v
┌─────────────────────────────────────────────────────────────┐
│                    CreateWalletHandler                      │
│  1. Lock  2. Check  3. Create  4. Persist  5. Project      │
└─────────────────────────────────────────────────────────────┘
      │         │         │          │           │
      v         v         v          v           v
   Redis   EventStore  Aggregate  PostgreSQL  Projections
   (Lock)   (Events)   (Logic)    (Data)      (ReadModel+Ledger)
```

---

## 🎯 Summary

**Tổng số bước:** 10 bước chính

**Components tham gia:**
1. ✅ WalletController (REST API)
2. ✅ CommandBus (CQRS)
3. ✅ CreateWalletHandler (Application Service)
4. ✅ DistributedLock (Redis)
5. ✅ WalletAggregate (Domain)
6. ✅ EventStore (KurrentDB)
7. ✅ WalletRepository (PostgreSQL)
8. ✅ WalletProjection (Read Model)
9. ✅ LedgerProjection (Audit Log)
10. ✅ QueryBus (CQRS Read)

**Time Complexity:** ~100-200ms cho toàn bộ flow (tùy thuộc network và DB latency)

**Consistency Model:** Eventual Consistency với Event Store là source of truth

---

## 🔧 Technical Stack

- **Framework**: NestJS
- **CQRS**: @nestjs/cqrs
- **Event Store**: KurrentDB / EventStoreDB
- **Database**: PostgreSQL (TypeORM)
- **Lock**: Redis Distributed Lock
- **Architecture**: Event Sourcing + CQRS + DDD

---

## 📖 Related Documentation

- [LEDGER-EVENT-DRIVEN-ARCHITECTURE.md](LEDGER-EVENT-DRIVEN-ARCHITECTURE.md)
- [IMPLEMENTATION-SUMMARY.md](IMPLEMENTATION-SUMMARY.md)
- [CONCURRENCY-STRATEGY.md](CONCURRENCY-STRATEGY.md)


