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
  serviceName: process.env.SERVICE_NAME || "payment-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  orderTopic: process.env.ORDER_TOPIC || "orders.created",
  paymentTopic: process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed",
  consumerGroup: process.env.PAYMENT_GROUP_ID || "payment-group",
  metricsPort: parseInt(process.env.METRICS_PORT || "9101", 10),
  orderRetryTopic:
    process.env.ORDER_RETRY_TOPIC || `${process.env.ORDER_TOPIC || "orders.created"}.retry`,
  orderDlqTopic:
    process.env.ORDER_DLQ_TOPIC || `${process.env.ORDER_TOPIC || "orders.created"}.dlq`,
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

  await consumer.subscribe({ topic: config.orderTopic, fromBeginning: false });
  await consumer.subscribe({ topic: config.orderRetryTopic, fromBeginning: false });

  await consumer.run({
    eachMessage: async (payload) => {
      metrics.inflight.inc();
      const stopTimer = metrics.handlerDuration.startTimer();
      try {
        const result = await handleMessageWithRetryDlq({
          payload,
          producer,
          retryTopic: config.orderRetryTopic,
          dlqTopic: config.orderDlqTopic,
          maxAttempts: config.maxProcessingAttempts,
          retryDelaysMs: config.retryDelaysMs,
          log,
          metrics,
          handler: async ({ message, attempt }) => {
            const order = JSON.parse(message.value.toString());
            log("info", "processing payment", { order, attempt });

            await sleep(500);

            const event = {
              orderId: order.orderId,
              amount: order.amount,
              status: "paid",
              paidAt: Date.now(),
            };

            await withRetries(
              () =>
                producer.send({
                  topic: config.paymentTopic,
                  messages: [
                    {
                      key: order.orderId ? String(order.orderId) : undefined,
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
                    topic: config.paymentTopic,
                    attempt: attemptSend,
                    error: error.message,
                  }),
              }
            );

            log("info", "payment completed event published", {
              topic: config.paymentTopic,
              event,
            });
            metrics.consumed.labels(payload.topic).inc();
            metrics.produced.labels(config.paymentTopic).inc();
            monitor.event("payment_completed", {
              topic: config.paymentTopic,
              attempt,
            });
          },
        });

        if (result.status !== "processed") {
          metrics.handlerErrors.labels("payment").inc();
          monitor.error("payment_failed", { status: result.status });
        }
      } catch (error) {
        log("error", "payment handling failed", { error: error.message });
        metrics.handlerErrors.labels("payment").inc();
        monitor.error("payment_failed", { error: error.message });
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