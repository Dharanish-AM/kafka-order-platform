const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "inventory-service",
  brokers: ["localhost:9092"],
});

const consumer = kafka.consumer({ groupId: "inventory-group" });
const producer = kafka.producer();

async function start() {
  await consumer.connect();
  await producer.connect();
  console.log("Inventory service connected to Kafka");

  await consumer.subscribe({
    topic: "payments.completed",
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const paymentEvent = JSON.parse(message.value.toString());

      console.log("\n📦 Reserving inventory for order:", paymentEvent.orderId);

      // simulate inventory logic
      await new Promise((r) => setTimeout(r, 1000));

      const event = {
        orderId: paymentEvent.orderId,
        status: "stock_reserved",
        reservedAt: Date.now(),
      };

      await producer.send({
        topic: "inventory.reserved",
        messages: [{ value: JSON.stringify(event) }],
      });

      console.log("🎯 Inventory reserved event published:", event);
    },
  });
}

start().catch(console.error);