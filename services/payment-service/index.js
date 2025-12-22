const { Kafka } = require("kafkajs");
const {
  createLogger,
  withRetries,
  sleep,
  createMonitor,
  registerShutdown,
} = require("../../common");
require("dotenv").config();

const config = {
  serviceName: process.env.SERVICE_NAME || "payment-service",
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  orderTopic: process.env.ORDER_TOPIC || "orders.created",
  paymentTopic: process.env.PAYMENT_COMPLETED_TOPIC || "payments.completed",
  consumerGroup: process.env.PAYMENT_GROUP_ID || "payment-group",
};

const log = createLogger(config.serviceName);
const monitor = createMonitor(config.serviceName, log);

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

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const order = JSON.parse(message.value.toString());
        log("info", "processing payment", { order });

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
              messages: [{ value: JSON.stringify(event) }],
            }),
          {
            retries: 3,
            delayMs: 200,
            logger: log,
            onRetry: (attempt, error) =>
              log("warn", "producer send retry", {
                topic: config.paymentTopic,
                attempt,
                error: error.message,
              }),
          }
        );

        log("info", "payment completed event published", {
          topic: config.paymentTopic,
          event,
        });
        monitor.event("payment_completed", { topic: config.paymentTopic });
      } catch (error) {
        log("error", "payment handling failed", { error: error.message });
        monitor.error("payment_failed", { error: error.message });
      }
    },
  });
}

registerShutdown(log, [
  () => consumer.disconnect(),
  () => producer.disconnect(),
]);

start().catch((error) => {
  log("error", "startup failure", { error: error.message });
  process.exit(1);
});