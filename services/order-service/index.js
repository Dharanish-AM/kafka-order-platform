const express = require("express");
const { Kafka } = require("kafkajs");

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: "order-service",
  brokers: ["localhost:9092"],
});

const producer = kafka.producer();

(async () => {
  await producer.connect();
  console.log("Kafka Producer connected");
})();

app.post("/order", async (req, res) => {
  const order = req.body;

  await producer.send({
    topic: "orders.created",
    messages: [{ value: JSON.stringify(order) }],
  });

  res.json({ status: "order published", order });
});

app.listen(4000, () => console.log("Order service running on 4000"));