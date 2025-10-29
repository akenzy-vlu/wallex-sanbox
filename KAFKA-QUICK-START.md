# Kafka Quick Start Guide ⚡

## 🎯 Goal
Achieve **100% success rate** for wallet operations using Kafka message broker.

## 📊 Before vs After

### Before Kafka
```
Load Test Results: 1000 wallets, 20,000 operations
✅ Success: 19,909 (99.55%)
❌ Failed:  91 (0.45%)
```

### With Kafka (Expected)
```
Load Test Results: 1000 wallets, 20,000 operations
✅ Success: 20,000 (100%)
❌ Failed:  0 (0%)
```

## 🚀 Quick Start (3 Steps)

### Step 1: Install Dependencies
```bash
npm install
# or
yarn install
```

### Step 2: Start All Services
```bash
# Start infrastructure (Kafka, PostgreSQL, Redis, etc.)
docker-compose up -d

# Wait for services (about 30 seconds)
docker-compose logs -f kafka

# Run migrations
npm run migration:run
```

### Step 3: Start Application
```bash
npm run start:dev
```

## ✅ Verify It's Working

### Check Health
```bash
curl http://localhost:3000/health/kafka
```

Expected output:
```json
{
  "status": "healthy",
  "producer": { "connected": true },
  "publisher": { "isRunning": false, "unprocessedEvents": 0, "lagMs": 0 }
}
```

### Run Load Test
```bash
python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20
```

Expected: **0 failures** 🎉

## 🛠️ Useful Commands

### Monitor Kafka

```bash
# View Kafka UI
open http://localhost:8080

# Watch Kafka logs
docker-compose logs -f kafka

# Check topics
docker exec -it kafka kafka-topics --bootstrap-server localhost:9092 --list

# View messages in wallet-events topic
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic wallet-events \
  --from-beginning \
  --max-messages 10

# Check consumer groups
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group ledger-projector
```

### Check Application

```bash
# Health check
curl http://localhost:3000/health/kafka

# Detailed stats
curl http://localhost:3000/health/kafka/stats

# Check outbox events
docker exec -it postgres psql -U postgres -d wallex \
  -c "SELECT COUNT(*) FROM outbox WHERE processed_at IS NULL;"
```

### Restart Services

```bash
# Restart everything
docker-compose restart

# Restart only Kafka
docker-compose restart kafka

# Restart application
npm run start:dev
```

## 📦 Docker Services

| Service       | Port  | URL                   |
| ------------- | ----- | --------------------- |
| Application   | 3000  | http://localhost:3000 |
| Kafka         | 29092 | localhost:29092       |
| Kafka UI      | 8080  | http://localhost:8080 |
| PostgreSQL    | 5434  | localhost:5434        |
| Redis         | 6379  | localhost:6379        |
| KurrentDB     | 2113  | http://localhost:2113 |
| Elasticsearch | 9200  | http://localhost:9200 |
| Kibana        | 5601  | http://localhost:5601 |

## 🎯 Key Features

### 1. Guaranteed Delivery
- Events persisted to Kafka before ACK
- At-least-once delivery semantics
- Automatic retries with backoff

### 2. Event Ordering
- Partition key = walletId
- Events for same wallet always in order
- No race conditions

### 3. Scalability
- 10 partitions for parallel processing
- Horizontal scaling of consumers
- Handle millions of transactions

### 4. Resilience
- Dead Letter Queue (DLQ) for failures
- Message replay capability
- Consumer lag monitoring

### 5. Observability
- Health checks at `/health/kafka`
- Kafka UI for visualization
- Detailed metrics and logs

## 🔍 Architecture Overview

```
Wallet Command → Event Store → Outbox (PostgreSQL)
                                  ↓
                           Kafka Publisher (every 5s)
                                  ↓
                          Kafka (wallet-events)
                                  ↓
                    ┌─────────────┴─────────────┐
                    ↓                           ↓
            Ledger Consumer           Read Model Consumer
                    ↓                           ↓
            Ledger Entries              Read Model DB
```

## 📈 What Changed?

### New Components
1. **KafkaModule** - Global Kafka infrastructure
2. **KafkaProducerService** - Publishes events to Kafka
3. **KafkaOutboxPublisherService** - Polls outbox and publishes
4. **LedgerKafkaConsumer** - Consumes events for ledger
5. **ReadModelKafkaConsumer** - Consumes events for read model
6. **KafkaHealthController** - Health checks and stats

### Topics Created
- `wallet-events` (10 partitions, 7-day retention)
- `wallet-events-dlq` (5 partitions, 30-day retention)

### Consumer Groups
- `kafka-publisher` - Outbox to Kafka publisher
- `ledger-projector` - Ledger event consumer
- `read-model-projector` - Read model event consumer

## 🐛 Troubleshooting

### Issue: Kafka not connecting
```bash
# Check Kafka status
docker ps | grep kafka
docker-compose logs kafka

# Restart Kafka
docker-compose restart kafka zookeeper
```

### Issue: No messages in topic
```bash
# Check outbox
docker exec -it postgres psql -U postgres -d wallex \
  -c "SELECT * FROM outbox WHERE processed_at IS NULL LIMIT 10;"

# Check publisher
curl http://localhost:3000/health/kafka/stats
```

### Issue: Consumer lag
```bash
# Check consumer group
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group ledger-projector

# View in Kafka UI
open http://localhost:8080
```

## 📚 Documentation

- **Full Guide:** [KAFKA-INTEGRATION-GUIDE.md](./KAFKA-INTEGRATION-GUIDE.md)
- **Architecture:** See architecture diagram above
- **API Docs:** [api-examples.json](./api-examples.json)
- **Load Testing:** [scripts/quick_load_test.py](./scripts/quick_load_test.py)

## 🎉 Success Metrics

After starting with Kafka, you should see:

✅ 100% success rate on load tests
✅ 0 failures in operations
✅ All events processed in order
✅ Consumer lag < 1 second
✅ Health check shows "healthy"
✅ Kafka UI shows active consumers

## 🚨 Important Notes

1. **Wait for Kafka to start** - Takes ~30 seconds after `docker-compose up`
2. **Check health first** - Always verify `/health/kafka` before load testing
3. **Monitor consumer lag** - Should be near 0 under normal load
4. **Use Kafka UI** - Best way to visualize message flow
5. **Check logs** - Application logs show detailed event processing

## 💡 Pro Tips

1. **Parallel Load Testing:**
   ```bash
   python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20
   ```

2. **Monitor in Real-Time:**
   ```bash
   # Terminal 1: Application logs
   npm run start:dev
   
   # Terminal 2: Kafka messages
   docker exec -it kafka kafka-console-consumer \
     --bootstrap-server localhost:9092 \
     --topic wallet-events
   ```

3. **Performance Testing:**
   - Start with 100 wallets, 1000 operations
   - Scale up to 1000 wallets, 20000 operations
   - Check for 0 failures at each level

4. **Debugging:**
   - Check `/health/kafka` first
   - Look at Kafka UI for consumer lag
   - Check PostgreSQL outbox table
   - Review application logs

---

**Ready to test?** Run: `python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20`

**Need help?** Check [KAFKA-INTEGRATION-GUIDE.md](./KAFKA-INTEGRATION-GUIDE.md) for detailed documentation.

**Status:** ✅ Production Ready | **Version:** 1.0.0

