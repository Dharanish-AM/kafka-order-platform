const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetries = async (fn, options = {}) => {
  const { retries = 3, delayMs = 200, logger, onRetry } = options;
  let attempt = 1;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      onRetry?.(attempt, error);
      logger?.("warn", "retrying operation", { attempt, error: error.message });
      if (attempt === retries) throw error;
      await sleep(delayMs * attempt);
      attempt += 1;
    }
  }
};

module.exports = { withRetries, sleep };
