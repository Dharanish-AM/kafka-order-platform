#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.kafka.yml"
SERVICES=(order-service payment-service inventory-service notification-service)

export KAFKAJS_NO_PARTITIONER_WARNING=1

echo "[start] Bringing up Kafka infra..."
docker compose -f "$COMPOSE_FILE" up -d

echo "[start] Installing service dependencies..."
for svc in "${SERVICES[@]}"; do
  echo "  -> $svc"
  npm install --prefix "$ROOT_DIR/services/$svc"
done

echo "[start] Launching services..."
pids=()
for svc in "${SERVICES[@]}"; do
  echo "  -> $svc"
  npm start --prefix "$ROOT_DIR/services/$svc" &
  pids+=("$!")
done

echo "[start] Services starting; waiting for processes (Ctrl+C to stop)"
for pid in "${pids[@]}"; do
  wait "$pid"
done
