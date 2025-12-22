const { Kafka } = require("kafkajs");
const {
  createLogger,
  sleep,
  createMonitor,
  registerShutdown,
} = require("../../common");
require("dotenv").config();

const config = {
  serviceName: process.env.SERVICE_NAME || "notification-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  inventoryTopic: process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved",
  consumerGroup: process.env.NOTIFICATION_GROUP_ID || "notification-group",
};

const log = createLogger(config.serviceName);
const monitor = createMonitor(config.serviceName, log);

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
      try {
        const event = JSON.parse(message.value.toString());

        log("info", "sending notification", { orderId: event.orderId });

        await sleep(800);

        log("info", "notification sent", { orderId: event.orderId });
        monitor.event("notification_sent", { orderId: event.orderId });
      } catch (error) {
        log("error", "notification handling failed", { error: error.message });
        monitor.error("notification_failed", { error: error.message });
      }
    },
  });
}

registerShutdown(log, [() => consumer.disconnect()]);

start().catch((error) => {
  log("error", "startup failure", { error: error.message });
  process.exit(1);
});