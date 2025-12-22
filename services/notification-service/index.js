const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "notification-service",
  brokers: ["localhost:9092"],
});

const consumer = kafka.consumer({ groupId: "notification-group" });

async function start() {
  await consumer.connect();
  console.log("Notification service connected to Kafka");

  await consumer.subscribe({
    topic: "inventory.reserved",
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value.toString());

      console.log("\n📩 Sending notification for order:", event.orderId);

      // simulate sending notification
      await new Promise((r) => setTimeout(r, 800));

      console.log(
        `✅ Notification successfully sent for order ${event.orderId}`
      );
    },
  });
}

start().catch(console.error);