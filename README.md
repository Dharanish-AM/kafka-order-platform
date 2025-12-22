# Kafka Order Platform

An event‑driven microservices demo powered by Kafka and Node.js.

- Order Service: REST API that publishes `orders.created`
- Payment Service: consumes `orders.created`, publishes `payments.completed`
- Inventory Service: consumes `payments.completed`, publishes `inventory.reserved`
- Notification Service: consumes `inventory.reserved`

## Prerequisites
- Node.js 18+
- Docker + Docker Compose

## Run the stack
1) Start Kafka infra
```sh
docker compose -f docker/docker-compose.kafka.yml up -d
```
2) Install dependencies (once per service)
```sh
npm install --prefix services/order-service
npm install --prefix services/payment-service
npm install --prefix services/inventory-service
npm install --prefix services/notification-service
```
3) Start all services (choose one)
```sh
# Using npm script defined at the root (if present)
npm run start:services

# Or use the helper script
./start.sh
```

## Monitoring
- Infra: Prometheus, Grafana, and Kafka Exporter run via the same compose file.
- Service metrics endpoints (host):
	- Order: http://localhost:9100/metrics
	- Payment: http://localhost:9101/metrics
	- Inventory: http://localhost:9102/metrics
	- Notification: http://localhost:9103/metrics
- Grafana: http://localhost:3000 (admin/admin)
	- Add Prometheus data source: http://localhost:9090 (from your browser)
	- Or `http://prometheus:9090` when configured inside a Grafana container

## Environment variables (per service)
- KAFKA_BROKERS: Kafka bootstrap list (default: `localhost:9092`)
- ORDER_TOPIC: default `orders.created`
- PAYMENT_COMPLETED_TOPIC: default `payments.completed`
- INVENTORY_RESERVED_TOPIC: default `inventory.reserved`
- SERVICE_NAME: logical name reported in logs/metrics
- PORT: only for Order Service REST API (default: `4000`)
- PAYMENT_GROUP_ID / INVENTORY_GROUP_ID / NOTIFICATION_GROUP_ID: consumer groups
- METRICS_PORT: default 9100/9101/9102/9103 per service
- KAFKAJS_NO_PARTITIONER_WARNING: set to `1` to silence partitioner warnings

## Event flow
Order → `orders.created` → Payment → `payments.completed` → Inventory → `inventory.reserved` → Notification

## Smoke test
Send an order and watch logs flow through all services:
```sh
curl -X POST http://localhost:4000/order \
	-H "Content-Type: application/json" \
	-d '{"orderId":"o1","amount":42}'
```

Expected log progression:
- Order: published `orders.created`
- Payment: processed payment, published `payments.completed`
- Inventory: reserved stock, published `inventory.reserved`
- Notification: sent notification

## Stop
```sh
docker compose -f docker/docker-compose.kafka.yml down
```

## Troubleshooting
- Kafka unreachable: ensure compose is up and port 9092 is free
- Consumers not receiving: check consumer groups and topic names match
- Metrics not visible: confirm service metrics ports (9100–9103) are listening
- Grafana empty: set Prometheus data source to http://localhost:9090