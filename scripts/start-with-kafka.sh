#!/bin/bash

echo "=========================================="
echo "🚀 Starting Wallex with Kafka"
echo "=========================================="
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running"
  echo "Please start Docker and try again"
  exit 1
fi

echo "📦 Starting infrastructure services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."

# Wait for PostgreSQL
echo "  - Waiting for PostgreSQL..."
until docker exec postgres pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
echo "  ✅ PostgreSQL is ready"

# Wait for Kafka
echo "  - Waiting for Kafka..."
sleep 10
until docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null 2>&1; do
  sleep 2
done
echo "  ✅ Kafka is ready"

# Wait for Redis
echo "  - Waiting for Redis..."
until docker exec redis redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo "  ✅ Redis is ready"

echo ""
echo "🗄️  Running database migrations..."
npm run migration:run

echo ""
echo "📊 Infrastructure Status:"
echo "  - PostgreSQL:    http://localhost:5434"
echo "  - Kafka:         http://localhost:29092"
echo "  - Kafka UI:      http://localhost:8080"
echo "  - Zookeeper:     http://localhost:2181"
echo "  - Redis:         http://localhost:6379"
echo "  - Elasticsearch: http://localhost:9200"
echo "  - Kibana:        http://localhost:5601"
echo "  - KurrentDB:     http://localhost:2113"
echo ""

echo "🎯 Starting Wallex application..."
npm run start:dev

echo ""
echo "=========================================="
echo "✅ Application started successfully!"
echo "=========================================="
echo ""
echo "📍 Endpoints:"
echo "  - API:           http://localhost:3000"
echo "  - Health Check:  http://localhost:3000/health/kafka"
echo "  - Kafka Stats:   http://localhost:3000/health/kafka/stats"
echo ""
echo "🧪 Run load test:"
echo "  python3 scripts/quick_load_test.py --wallets 1000 --operations 20000 --fast --workers 20"
echo ""

