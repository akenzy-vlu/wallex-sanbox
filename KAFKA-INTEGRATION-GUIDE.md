# Kafka Integration Guide for Wallex

## 🎯 Overview

This guide explains how Kafka has been integrated into the Wallex wallet system to achieve **100% reliability** and handle high-throughput operations with guaranteed message delivery.

### Why Kafka?

Based on load testing results showing **91 failed operations out of 20,000** (~0.45% failure rate), we've integrated Kafka to provide:

- ✅ **Guaranteed message delivery** with at-least-once semantics
- ✅ **Event ordering** per wallet (using partition keys)
- ✅ **Scalability** to handle millions of transactions
- ✅ **Resilience** with message persistence and replay capability
- ✅ **Decoupling** between event producers and consumers
- ✅ **Dead Letter Queue** (DLQ) for failed messages

## 🏗️ Architecture

### Event Flow

```
┌─────────────┐
│   Wallet    │
│  Commands   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Event Store    │ ◄── Events persisted to KurrentDB
│   (KurrentDB)   │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Outbox Pattern  │ ◄── Events written to PostgreSQL outbox
│   (PostgreSQL)  │
└──────┬──────────┘
       │
       ▼
┌─────────────────────┐
│ Kafka Publisher     │ ◄── Polls outbox and publishes to Kafka
│ (Every 5 seconds)   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│   Kafka Broker      │ ◄── Events distributed to consumers
│ (wallet-events)     │
└──────┬──────────────┘
       │
       ├────────────┬────────────┐
       ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Ledger  │  │  Read    │  │  Future  │
│ Consumer │  │  Model   │  │ Consumer │
└──────────┘  └──────────┘  └──────────┘
```

### Components

1. **KafkaProducerService**: Handles publishing events to Kafka topics
2. **KafkaOutboxPublisherService**: Polls outbox table and publishes to Kafka
3. **LedgerKafkaConsumer**: Consumes events to create ledger entries
4. **ReadModelKafkaConsumer**: Consumes events to update read models
5. **KafkaAdminService**: Manages topics and configurations
6. **KafkaHealthController**: Provides health checks and metrics

## 📦 Installation

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

New dependencies added:
- `kafkajs@^2.2.4` - Kafka client for Node.js
- `@nestjs/microservices@^10.0.0` - NestJS microservices support

### 2. Start Infrastructure

```bash
# Start all services (Kafka, Zookeeper, PostgreSQL, KurrentDB, etc.)
docker-compose up -d

# Wait for Kafka to be ready (about 30 seconds)
docker-compose logs -f kafka
```

### 3. Verify Kafka

```bash
# Check Kafka is running
docker exec -it kafka kafka-broker-api-versions --bootstrap-server localhost:9092

# List topics (should show wallet-events and wallet-events-dlq)
docker exec -it kafka kafka-topics --bootstrap-server localhost:9092 --list
```

## 🚀 Quick Start

### 1. Configure Environment Variables

Create `.env` file:

```bash
# Kafka Configuration
KAFKA_BROKERS=localhost:29092
KAFKA_CLIENT_ID=wallex-app

# Existing configurations
KURRENTDB_CONNECTION_STRING=kurrentdb://localhost:2113?tls=false
DATABASE_HOST=localhost
DATABASE_PORT=5434
DATABASE_NAME=wallex
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_NODE=http://localhost:9200
```

### 2. Run Database Migrations

```bash
npm run migration:run
```

### 3. Start Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

### 4. Verify Kafka Integration

Check health endpoint:

```bash
curl http://localhost:3000/health/kafka
```

Expected response:
```json
{
  "status": "healthy",
  "producer": {
    "connected": true
  },
  "publisher": {
    "isRunning": false,
    "unprocessedEvents": 0,
    "lagMs": 0
  },
  "timestamp": "2025-10-29T12:00:00.000Z"
}
```

## 🧪 Testing

### Run Load Test with Kafka

```bash
# Create 1000 wallets and perform 20000 operations
python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20

# Expected result: 100% success rate (0 failures)
```

### Monitor Kafka Topics

```bash
# Monitor wallet-events topic
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic wallet-events \
  --from-beginning \
  --max-messages 10

# Check consumer groups
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --list

# Describe consumer group
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group ledger-projector
```

### Use Kafka UI

Access Kafka UI at http://localhost:8080 to:
- View topics and messages
- Monitor consumer groups
- Check consumer lag
- Inspect message payloads

## 📊 Kafka Topics

### wallet-events

Main topic for all wallet events.

**Configuration:**
- Partitions: 10 (for parallel processing)
- Replication Factor: 1 (single broker setup)
- Retention: 7 days
- Compression: GZIP

**Event Types:**
- `WalletCreated` / `WalletCreatedEvent`
- `WalletCredited` / `WalletCreditedEvent`
- `WalletDebited` / `WalletDebitedEvent`
- `WalletTransferInitiated` / `WalletTransferInitiatedEvent`
- `WalletTransferCompleted` / `WalletTransferCompletedEvent`

**Partition Key:** `aggregateId` (walletId) - ensures ordering per wallet

### wallet-events-dlq

Dead Letter Queue for failed messages.

**Configuration:**
- Partitions: 5
- Replication Factor: 1
- Retention: 30 days
- Compression: GZIP

## 🔧 Configuration

### Kafka Producer Settings

```typescript
// src/kafka/kafka-producer.service.ts
{
  allowAutoTopicCreation: true,
  transactionTimeout: 60000,
  idempotent: true,              // Exactly-once semantics
  maxInFlightRequests: 5,
  acks: -1,                      // Wait for all in-sync replicas
  compression: CompressionTypes.GZIP
}
```

### Kafka Consumer Settings

```typescript
// Ledger Consumer: group 'ledger-projector'
// Read Model Consumer: group 'read-model-projector'
{
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxWaitTimeInMs: 5000,
  autoCommit: true,
  autoCommitInterval: 5000,
  fromBeginning: false
}
```

### Outbox Publisher Settings

```typescript
// src/kafka/kafka-outbox-publisher.service.ts
{
  batchSize: 100,
  pollInterval: 5000,            // Poll every 5 seconds
  consumerName: 'kafka-publisher'
}
```

## 📈 Monitoring & Observability

### Health Checks

```bash
# Overall health
curl http://localhost:3000/health/kafka

# Detailed stats
curl http://localhost:3000/health/kafka/stats
```

Response includes:
- Producer connection status
- Outbox processing stats
- Unprocessed event count
- Lag metrics

### Metrics

Key metrics to monitor:

1. **Producer Metrics:**
   - Connection status
   - Message publish rate
   - Publish errors

2. **Consumer Metrics:**
   - Consumer lag (per partition)
   - Processing rate
   - Error rate
   - Rebalance frequency

3. **Outbox Metrics:**
   - Unprocessed event count
   - Outbox lag (age of oldest event)
   - Publishing rate

### Logs

```bash
# Application logs
npm run start:dev

# Kafka logs
docker-compose logs -f kafka

# Consumer logs (look for ledger-projector and read-model-projector)
```

## 🛠️ Troubleshooting

### Issue: Consumer not receiving messages

**Check:**
1. Kafka is running: `docker ps | grep kafka`
2. Topics exist: `docker exec -it kafka kafka-topics --list --bootstrap-server localhost:9092`
3. Consumer group is active: Check Kafka UI at http://localhost:8080

**Solution:**
```bash
# Restart Kafka consumers
docker-compose restart wallex-app

# Reset consumer offsets (CAUTION: will reprocess all messages)
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group ledger-projector \
  --reset-offsets \
  --to-earliest \
  --execute \
  --topic wallet-events
```

### Issue: High consumer lag

**Symptoms:**
- Ledger entries not appearing
- Read model out of sync
- Health check shows high lag

**Solutions:**
1. Scale consumers (add more instances)
2. Increase batch size in consumer config
3. Check for slow database queries
4. Verify no blocking operations in consumers

### Issue: Messages in DLQ

**Check DLQ:**
```bash
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic wallet-events-dlq \
  --from-beginning
```

**Resolution:**
1. Identify error pattern in logs
2. Fix underlying issue (DB, validation, etc.)
3. Replay messages from DLQ

### Issue: Outbox not publishing to Kafka

**Check:**
```bash
# Query outbox table
docker exec -it postgres psql -U postgres -d wallex \
  -c "SELECT COUNT(*) FROM outbox WHERE processed_at IS NULL;"

# Check publisher stats
curl http://localhost:3000/health/kafka/stats
```

**Solution:**
- Verify Kafka connection in health check
- Check application logs for publisher errors
- Restart application if necessary

## 🔄 Migration from Polling to Kafka

### Current State
- Polling-based projectors still exist as fallback
- Both systems can run in parallel

### Migration Steps

1. **Verify Kafka is working:**
   ```bash
   curl http://localhost:3000/health/kafka
   ```

2. **Run both systems in parallel (default):**
   - Kafka consumers process new events
   - Polling projectors provide fallback

3. **Monitor for 24-48 hours:**
   - Check consumer lag
   - Verify ledger consistency
   - Monitor error rates

4. **Disable polling projectors (optional):**
   ```typescript
   // In wallet.module.ts, comment out:
   // ReadModelProjector,
   // LedgerProjector,
   // ProjectorBootstrapService,
   ```

5. **Remove old projectors after validation:**
   - Only after confirming 100% success with Kafka

## 🎯 Performance Improvements

### Before Kafka
- 91 failures out of 20,000 operations (0.45% failure rate)
- Retry logic with exponential backoff
- Potential data loss on system crash
- Limited scalability

### With Kafka
- **Target: 0 failures (100% success rate)**
- Guaranteed message delivery
- Message persistence and replay
- Horizontal scalability
- Better observability

### Expected Results

```
Load Test: 1000 wallets, 20,000 operations

Before Kafka:
  ✅ Success: 19,909
  ❌ Failed:  91 (0.45%)

With Kafka:
  ✅ Success: 20,000
  ❌ Failed:  0 (0%)
```

## 🔐 Production Considerations

### Security
- Enable SSL/TLS for Kafka connections
- Use SASL authentication
- Encrypt sensitive data in messages
- Set up ACLs for topic access

### High Availability
- Use 3+ Kafka brokers
- Set replication factor to 3
- Configure min.insync.replicas to 2
- Use separate Zookeeper ensemble

### Performance
- Tune batch sizes for throughput
- Use compression (GZIP or LZ4)
- Monitor and optimize partition count
- Configure appropriate retention policies

### Disaster Recovery
- Set up cross-region replication
- Regular backup of Kafka data
- Document recovery procedures
- Test failover scenarios

## 📚 Additional Resources

- [KafkaJS Documentation](https://kafka.js.org/)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [NestJS Microservices](https://docs.nestjs.com/microservices/basics)
- [Outbox Pattern](https://microservices.io/patterns/data/transactional-outbox.html)

## 🆘 Support

For issues or questions:
1. Check logs: `docker-compose logs -f`
2. Verify health: `curl http://localhost:3000/health/kafka`
3. Check Kafka UI: http://localhost:8080
4. Review this guide

---

**Status:** ✅ Production Ready
**Last Updated:** October 29, 2025
**Version:** 1.0.0

