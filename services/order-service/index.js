const express = require("express");
const { Kafka } = require("kafkajs");
const {
  createLogger,
  withRetries,
  createMonitor,
  registerShutdown,
} = require("../../common");
require("dotenv").config();

const config = {
  serviceName: process.env.SERVICE_NAME || "order-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  orderTopic: process.env.ORDER_TOPIC || "orders.created",
  port: parseInt(process.env.PORT || "4000", 10),
};

const log = createLogger(config.serviceName);
const monitor = createMonitor(config.serviceName, log);

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: config.serviceName,
  brokers: config.kafkaBrokers,
});

const producer = kafka.producer();

const start = async () => {
  try {
    await producer.connect();
    log("info", "producer connected", { brokers: config.kafkaBrokers });
  } catch (error) {
    log("error", "failed to connect producer", { error: error.message });
    process.exit(1);
  }

  app.post("/order", async (req, res) => {
    const order = req.body || {};
    try {
      await withRetries(
        () =>
          producer.send({
            topic: config.orderTopic,
            messages: [{ value: JSON.stringify(order) }],
          }),
        {
          retries: 3,
          delayMs: 200,
          logger: log,
          onRetry: (attempt, error) =>
            log("warn", "producer send retry", {
              topic: config.orderTopic,
              attempt,
              error: error.message,
            }),
        }
      );

      log("info", "order published", { topic: config.orderTopic, order });
      monitor.event("order_published", { topic: config.orderTopic });
      res.json({ status: "order published", order });
    } catch (error) {
      log("error", "failed to publish order", { error: error.message, order });
      res.status(500).json({ error: "failed to publish order" });
    }
  });

  app.listen(config.port, () => {
    log("info", "service listening", { port: config.port });
  });
};

registerShutdown(log, [() => producer.disconnect()]);

start().catch((error) => {
  log("error", "startup failure", { error: error.message });
  process.exit(1);
});