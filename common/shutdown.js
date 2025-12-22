const registerShutdown = (logger, cleanups = []) => {
  const handler = async (signal) => {
    logger?.("info", "shutting down", { signal });
    for (const fn of cleanups) {
      try {
        await fn();
      } catch (error) {
        logger?.("error", "shutdown step failed", { error: error.message });
      }
    }
    process.exit(0);
  };

  ["SIGINT", "SIGTERM"].forEach((signal) => process.on(signal, handler));
};

module.exports = { registerShutdown };
