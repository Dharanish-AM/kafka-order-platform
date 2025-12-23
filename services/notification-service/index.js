const { Kafka } = require("kafkajs");
const {
  createLogger,
  sleep,
  createMonitor,
  registerShutdown,
  createMetrics,
  handleMessageWithRetryDlq,
} = require("../../common");
require("dotenv").config();

const parseRetryDelays = (value = "") =>
  value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((num) => !Number.isNaN(num) && num >= 0);

const config = {
  serviceName: process.env.SERVICE_NAME || "notification-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  inventoryTopic: process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved",
  consumerGroup: process.env.NOTIFICATION_GROUP_ID || "notification-group",
  metricsPort: parseInt(process.env.METRICS_PORT || "9103", 10),
  inventoryRetryTopic:
    process.env.INVENTORY_RETRY_TOPIC ||
    `${process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved"}.retry`,
  inventoryDlqTopic:
    process.env.INVENTORY_DLQ_TOPIC ||
    `${process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved"}.dlq`,
  maxProcessingAttempts: parseInt(process.env.MAX_PROCESSING_ATTEMPTS || "3", 10),
  retryDelaysMs: parseRetryDelays(
    process.env.RETRY_DELAYS_MS || "1000,5000,15000"
  ),
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
    topic: config.inventoryTopic,
    fromBeginning: false,
  });
  await consumer.subscribe({
    topic: config.inventoryRetryTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async (payload) => {
      metrics.inflight.inc();
      const stopTimer = metrics.handlerDuration.startTimer();
      try {
        const result = await handleMessageWithRetryDlq({
          payload,
          producer,
          retryTopic: config.inventoryRetryTopic,
          dlqTopic: config.inventoryDlqTopic,
          maxAttempts: config.maxProcessingAttempts,
          retryDelaysMs: config.retryDelaysMs,
          log,
          metrics,
          handler: async ({ message, attempt }) => {
            const event = JSON.parse(message.value.toString());

            log("info", "sending notification", {
              orderId: event.orderId,
              attempt,
            });

            await sleep(800);

            log("info", "notification sent", { orderId: event.orderId });
            metrics.consumed.labels(payload.topic).inc();
            monitor.event("notification_sent", {
              orderId: event.orderId,
              attempt,
            });
          },
        });

        if (result.status !== "processed") {
          metrics.handlerErrors.labels("notification").inc();
          monitor.error("notification_failed", { status: result.status });
        }
      } catch (error) {
        log("error", "notification handling failed", { error: error.message });
        metrics.handlerErrors.labels("notification").inc();
        monitor.error("notification_failed", { error: error.message });
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