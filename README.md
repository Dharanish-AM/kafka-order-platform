# Kafka Order Platform

Event-driven demo with Kafka and four Node services: Order (REST producer), Payment (consumer then producer), Inventory (consumer then producer), Notification (consumer).

## Prerequisites
- Node.js 18+
- Docker + Docker Compose

## Run the stack
1) Start Kafka infra: docker compose -f docker/docker-compose.kafka.yml up -d
2) Install deps (run once per service): npm install --prefix services/<service-name>
3) Start services: npm run start:services

## Environment variables (per service)
- KAFKA_BROKERS (default: localhost:9092, comma separated)
- ORDER_TOPIC (default: orders.created)
- PAYMENT_COMPLETED_TOPIC (default: payments.completed)
- INVENTORY_RESERVED_TOPIC (default: inventory.reserved)
- SERVICE_NAME (default: service folder name)
- PORT (order-service only, default: 4000)
- GROUP_ID overrides: PAYMENT_GROUP_ID, INVENTORY_GROUP_ID, NOTIFICATION_GROUP_ID

## Event flow
Order -> orders.created -> Payment -> payments.completed -> Inventory -> inventory.reserved -> Notification

## Smoke test
Send an order and watch logs flow through all services:
curl -X POST http://localhost:4000/order -H "Content-Type: application/json" -d '{"orderId":"o1","amount":42}'

## Stop
docker compose -f docker/docker-compose.kafka.yml down