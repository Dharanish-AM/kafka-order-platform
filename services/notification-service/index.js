const { Kafka } = require("kafkajs");
const {
  createLogger,
  sleep,
  createMonitor,
  registerShutdown,
  createMetrics,
} = require("../../common");
require("dotenv").config();

const config = {
  serviceName: process.env.SERVICE_NAME || "notification-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  inventoryTopic: process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved",
  consumerGroup: process.env.NOTIFICATION_GROUP_ID || "notification-group",
  metricsPort: parseInt(process.env.METRICS_PORT || "9103", 10),
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

async function start() {
  try {
    await consumer.connect();
    log("info", "consumer connected", {
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

  await consumer.run({
    eachMessage: async ({ message }) => {
      metrics.inflight.inc();
      const stopTimer = metrics.handlerDuration.startTimer();
      try {
        const event = JSON.parse(message.value.toString());

        log("info", "sending notification", { orderId: event.orderId });

        await sleep(800);

        log("info", "notification sent", { orderId: event.orderId });
        metrics.consumed.labels(config.inventoryTopic).inc();
        monitor.event("notification_sent", { orderId: event.orderId });
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