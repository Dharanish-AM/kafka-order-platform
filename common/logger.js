const createLogger = (serviceName = "app") => (level, message, meta = {}) => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: serviceName,
    message,
    ...meta,
  };
  console.log(JSON.stringify(entry));
};

module.exports = { createLogger };
