const http = require("http");
const client = require("prom-client");

const createMetrics = (serviceName = "app") => {
  const register = new client.Registry();
  register.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register });

  const consumed = new client.Counter({
    name: "kafka_messages_consumed_total",
    help: "Total Kafka messages consumed",
    labelNames: ["topic"],
    registers: [register],
  });

  const produced = new client.Counter({
    name: "kafka_messages_produced_total",
    help: "Total Kafka messages produced",
    labelNames: ["topic"],
    registers: [register],
  });

  const handlerErrors = new client.Counter({
    name: "handler_errors_total",
    help: "Total handler errors",
    labelNames: ["stage"],
    registers: [register],
  });

  const handlerDuration = new client.Histogram({
    name: "handler_duration_seconds",
    help: "Handler duration in seconds",
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  });

  const inflight = new client.Gauge({
    name: "inflight_handlers",
    help: "Number of handlers currently running",
    registers: [register],
  });

  const startServer = (port = 9100) => {
    const server = http.createServer(async (req, res) => {
      if (req.url === "/metrics") {
        const metrics = await register.metrics();
        res.writeHead(200, { "Content-Type": register.contentType });
        res.end(metrics);
        return;
      }
      if (req.url === "/health" || req.url === "/ready") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(port, () => {
      console.log(
        JSON.stringify({
          level: "info",
          service: serviceName,
          message: "metrics server listening",
          port,
        })
      );
    });

    return server;
  };

  return {
    register,
    consumed,
    produced,
    handlerErrors,
    handlerDuration,
    inflight,
    startServer,
  };
};

module.exports = { createMetrics };
