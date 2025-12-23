# Kafka Order Platform

Event-driven microservices demo on Kafka + Node.js with metrics, retries, and DLQs.

## Architecture
- Order Service: REST API → publishes `orders.created`
- Payment Service: consumes `orders.created` → publishes `payments.completed`
- Inventory Service: consumes `payments.completed` → publishes `inventory.reserved`
- Notification Service: consumes `inventory.reserved`
- Retry/DLQ: each consumer can forward failures to `<topic>.retry` then `<topic>.dlq` with `x-attempt`/`x-error` headers.

## Prerequisites
- Node.js 18+
- Docker + Docker Compose

## Quick start (one command)
```sh
./start.sh
```
- Brings up Kafka/ZooKeeper/Prometheus/Grafana/Kafka Exporter
- Installs per-service dependencies
- Runs all services with `nodemon`

## Manual start (optional)
```sh
# 1) Infra
docker compose -f docker/docker-compose.kafka.yml up -d

# 2) Install deps (once)
npm install --prefix services/order-service
npm install --prefix services/payment-service
npm install --prefix services/inventory-service
npm install --prefix services/notification-service

# 3) Run services (in separate shells)
npm run dev --prefix services/order-service
npm run dev --prefix services/payment-service
npm run dev --prefix services/inventory-service
npm run dev --prefix services/notification-service
```

## Smoke test
```sh
curl -X POST http://localhost:4000/order \
  -H "Content-Type: application/json" \
  -d '{"orderId":"o1","amount":42}'
```
Expected: order → payment → inventory → notification logs; metrics increment on each hop.

## Load generator
```sh
npm run load -- --rps 20 --duration 120 --concurrency 2 --url http://localhost:4000/order
```
Flags: `--rps` (default 10), `--duration` seconds (default 60), `--concurrency` (default 1), `--url` (default http://localhost:4000/order).

## Observability
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/admin)
- Kafka Exporter: http://localhost:9308/metrics
- Service metrics: Order 9100, Payment 9104, Inventory 9102, Notification 9103 (`/metrics` on each)
- Default Grafana datasource: point to http://localhost:9090 (or `http://prometheus:9090` inside containers)

## Configuration
Shared:
- `KAFKA_BROKERS` (default `localhost:9092`)
- `KAFKAJS_NO_PARTITIONER_WARNING=1` to silence partitioner notice

Topics:
- `ORDER_TOPIC` (default `orders.created`)
- `PAYMENT_COMPLETED_TOPIC` (default `payments.completed`)
- `INVENTORY_RESERVED_TOPIC` (default `inventory.reserved`)

Retry/DLQ (per consumer):
- `ORDER_RETRY_TOPIC` / `ORDER_DLQ_TOPIC` (defaults `<ORDER_TOPIC>.retry` / `<ORDER_TOPIC>.dlq`)
- `PAYMENT_RETRY_TOPIC` / `PAYMENT_DLQ_TOPIC`
- `INVENTORY_RETRY_TOPIC` / `INVENTORY_DLQ_TOPIC`
- `MAX_PROCESSING_ATTEMPTS` (default 3)
- `RETRY_DELAYS_MS` comma list (default `1000,5000,15000`)

Per service:
- `SERVICE_NAME` (log/metric label)
- `PORT` (Order REST, default 4000)
- Consumer groups: `PAYMENT_GROUP_ID`, `INVENTORY_GROUP_ID`, `NOTIFICATION_GROUP_ID`
- `METRICS_PORT` (9100/9104/9102/9103 defaults)

## Stop
```sh
docker compose -f docker/docker-compose.kafka.yml down
```

## Troubleshooting
- Kafka unreachable: ensure compose is up and port 9092 is free.
- Exporter target down: rerun compose; exporter waits for Kafka health and restarts automatically.
- Metrics missing: confirm service metric ports are listening and Prometheus targets are up.
- Grafana empty: set Prometheus datasource to http://localhost:9090.
