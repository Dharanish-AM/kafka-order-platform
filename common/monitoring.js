const { createLogger } = require("./logger");

const createMonitor = (serviceName = "app", logger = createLogger(serviceName)) => ({
  event: (name, meta = {}) => logger("info", "monitor", { event: name, ...meta }),
  error: (name, meta = {}) => logger("error", "monitor", { event: name, ...meta }),
});

module.exports = { createMonitor };
