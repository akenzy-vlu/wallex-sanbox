# Kafka Quick Reference Cheat Sheet 🚀

## ⚡ Quick Start (3 Steps)

```bash
# 1. Install & Start
npm install && docker-compose up -d && sleep 30

# 2. Migrate & Run
npm run migration:run && npm run start:dev

# 3. Test
python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20
```

## 🔍 Health Checks

```bash
# Check Kafka health
curl http://localhost:3000/health/kafka

# Get detailed stats
curl http://localhost:3000/health/kafka/stats

# Check all services
docker-compose ps
```

## 📊 Monitoring

### Kafka UI
```bash
open http://localhost:8080
```

### Consumer Groups
```bash
# List groups
docker exec -it kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list

# Check lag
docker exec -it kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group ledger-projector
```

### View Messages
```bash
# Live messages
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic wallet-events

# From beginning
docker exec -it kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic wallet-events \
  --from-beginning \
  --max-messages 10
```

## 🐛 Troubleshooting

### Kafka not connecting
```bash
docker-compose restart kafka zookeeper
docker-compose logs -f kafka
```

### Check outbox
```bash
docker exec -it postgres psql -U postgres -d wallex \
  -c "SELECT COUNT(*) FROM outbox WHERE processed_at IS NULL;"
```

### Reset consumer offset
```bash
docker exec -it kafka kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --group ledger-projector \
  --reset-offsets \
  --to-earliest \
  --execute \
  --topic wallet-events
```

## 📦 Services & Ports

| Service    | Port  | URL                   |
| ---------- | ----- | --------------------- |
| App        | 3000  | http://localhost:3000 |
| Kafka      | 29092 | localhost:29092       |
| Kafka UI   | 8080  | http://localhost:8080 |
| PostgreSQL | 5434  | localhost:5434        |
| Redis      | 6379  | localhost:6379        |
| KurrentDB  | 2113  | http://localhost:2113 |

## 🧪 Load Testing

```bash
# Small test
python3 scripts/quick_load_test.py --wallets 100 --operations 1000 --fast

# Medium test
python3 scripts/quick_load_test.py --wallets 500 --operations 10000 --fast --workers 15

# Full test
python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20
```

## 📈 Expected Results

**Before:** 19,909 ✓ / 91 ✗ (99.55%)
**After:** 20,000 ✓ / 0 ✗ (100%) 🎉

## 🔄 Common Operations

### Restart everything
```bash
docker-compose restart && npm run start:dev
```

### Clean restart
```bash
docker-compose down -v
docker-compose up -d
sleep 30
npm run migration:run
npm run start:dev
```

### View logs
```bash
# Application
npm run start:dev

# Kafka
docker-compose logs -f kafka

# All services
docker-compose logs -f
```

## 📚 Documentation

- **Quick Start**: [KAFKA-QUICK-START.md](./KAFKA-QUICK-START.md)
- **Full Guide**: [KAFKA-INTEGRATION-GUIDE.md](./KAFKA-INTEGRATION-GUIDE.md)
- **Implementation**: [KAFKA-IMPLEMENTATION-COMPLETE.md](./KAFKA-IMPLEMENTATION-COMPLETE.md)

## 🎯 Success Criteria

✅ Health check returns "healthy"
✅ All consumer groups active
✅ Consumer lag < 1 second
✅ Load test: 0 failures
✅ All events processed in order

---

**Ready?** `npm install && docker-compose up -d && sleep 30 && npm run migration:run && npm run start:dev`

