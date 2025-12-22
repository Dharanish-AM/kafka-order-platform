const { Kafka } = require("kafkajs");
const {
  createLogger,
  withRetries,
  sleep,
  createMonitor,
  registerShutdown,
  createMetrics,
} = require("../../common");
require("dotenv").config();

const config = {
  serviceName: process.env.SERVICE_NAME || "inventory-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  paymentTopic: process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed",
  inventoryTopic: process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved",
  consumerGroup: process.env.INVENTORY_GROUP_ID || "inventory-group",
  metricsPort: parseInt(process.env.METRICS_PORT || "9102", 10),
};

const log = createLogger(config.serviceName);
const monitor = createMonitor(config.serviceName, log);
const metrics = createMetrics(config.serviceName);
let metricsServer;

const kafka = new Kafka({
  clientId: config.serviceName,
  brokers: config.kafkaBrokers,
});

const consumer = kafka.consumer({ groupId: config.consumerGroup });
const producer = kafka.producer();

async function start() {
  try {
    await consumer.connect();
    await producer.connect();
    log("info", "consumer and producer connected", {
      brokers: config.kafkaBrokers,
      groupId: config.consumerGroup,
    });
  } catch (error) {
    log("error", "failed to connect Kafka", { error: error.message });
    process.exit(1);
  }

  await consumer.subscribe({
    topic: config.paymentTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      metrics.inflight.inc();
      const stopTimer = metrics.handlerDuration.startTimer();
      try {
        const paymentEvent = JSON.parse(message.value.toString());

        log("info", "reserving inventory", { orderId: paymentEvent.orderId });

        await sleep(1000);

        const event = {
          orderId: paymentEvent.orderId,
          status: "stock_reserved",
          reservedAt: Date.now(),
        };

        await withRetries(
          () =>
            producer.send({
              topic: config.inventoryTopic,
              messages: [{ value: JSON.stringify(event) }],
            }),
          {
            retries: 3,
            delayMs: 200,
            logger: log,
            onRetry: (attempt, error) =>
              log("warn", "producer send retry", {
                topic: config.inventoryTopic,
                attempt,
                error: error.message,
              }),
          }
        );

        log("info", "inventory reserved event published", {
          topic: config.inventoryTopic,
          event,
        });
        metrics.consumed.labels(config.paymentTopic).inc();
        metrics.produced.labels(config.inventoryTopic).inc();
        monitor.event("inventory_reserved", { topic: config.inventoryTopic });
      } catch (error) {
        log("error", "inventory handling failed", { error: error.message });
        metrics.handlerErrors.labels("inventory").inc();
        monitor.error("inventory_failed", { error: error.message });
      } finally {
        metrics.inflight.dec();
        stopTimer();
      }
    },
  });

  metricsServer = metrics.startServer(config.metricsPort);
}

registerShutdown(log, [
  () => consumer.disconnect(),
  () => producer.disconnect(),
  () =>
    new Promise((resolve) => {
      if (metricsServer) {
        metricsServer.close(() => resolve());
      } else {
        resolve();
      }
    }),
]);

start().catch((error) => {
  log("error", "startup failure", { error: error.message });
  process.exit(1);
});