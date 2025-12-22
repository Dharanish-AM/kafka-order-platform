const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "payment-service",
  brokers: ["localhost:9092"],
});

const consumer = kafka.consumer({ groupId: "payment-group" });

async function start() {
  await consumer.connect();
  console.log("Payment consumer connected");

  await consumer.subscribe({ topic: "orders.created" });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const order = JSON.parse(message.value.toString());
      console.log("Processing payment:", order);
    },
  });
}

start();