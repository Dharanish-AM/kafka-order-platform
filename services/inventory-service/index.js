const { Kafka } = require("kafkajs");
const {
  createLogger,
  withRetries,
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
  serviceName: process.env.SERVICE_NAME || "inventory-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  paymentTopic: process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed",
  inventoryTopic: process.env.INVENTORY_RESERVED_TOPIC || "inventory.reserved",
  consumerGroup: process.env.INVENTORY_GROUP_ID || "inventory-group",
  metricsPort: parseInt(process.env.METRICS_PORT || "9102", 10),
  paymentRetryTopic:
    process.env.PAYMENT_RETRY_TOPIC ||
    `${process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed"}.retry`,
  paymentDlqTopic:
    process.env.PAYMENT_DLQ_TOPIC ||
    `${process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed"}.dlq`,
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
    topic: config.paymentTopic,
    fromBeginning: false,
  });
  await consumer.subscribe({
    topic: config.paymentRetryTopic,
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
          retryTopic: config.paymentRetryTopic,
          dlqTopic: config.paymentDlqTopic,
          maxAttempts: config.maxProcessingAttempts,
          retryDelaysMs: config.retryDelaysMs,
          log,
          metrics,
          handler: async ({ message, attempt }) => {
            const paymentEvent = JSON.parse(message.value.toString());

            log("info", "reserving inventory", {
              orderId: paymentEvent.orderId,
              attempt,
            });

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
                  messages: [
                    {
                      key: paymentEvent.orderId
                        ? String(paymentEvent.orderId)
                        : undefined,
                      value: JSON.stringify(event),
                    },
                  ],
                }),
              {
                retries: 3,
                delayMs: 200,
                logger: log,
                onRetry: (attemptSend, error) =>
                  log("warn", "producer send retry", {
                    topic: config.inventoryTopic,
                    attempt: attemptSend,
                    error: error.message,
                  }),
              }
            );

            log("info", "inventory reserved event published", {
              topic: config.inventoryTopic,
              event,
            });
            metrics.consumed.labels(payload.topic).inc();
            metrics.produced.labels(config.inventoryTopic).inc();
            monitor.event("inventory_reserved", {
              topic: config.inventoryTopic,
              attempt,
            });
          },
        });

        if (result.status !== "processed") {
          metrics.handlerErrors.labels("inventory").inc();
          monitor.error("inventory_failed", { status: result.status });
        }
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