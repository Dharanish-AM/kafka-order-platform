const { sleep } = require("./retry");

const bufferize = (value) => {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.from(String(value));
};

const mergeHeaders = (base = {}, extra = {}) => {
  const merged = {};
  Object.entries(base || {}).forEach(([key, value]) => {
    const buf = bufferize(value);
    if (buf !== undefined) merged[key] = buf;
  });
  Object.entries(extra || {}).forEach(([key, value]) => {
    const buf = bufferize(value);
    if (buf !== undefined) merged[key] = buf;
  });
  return merged;
};

const getAttempt = (headers = {}, attemptHeader = "x-attempt") => {
  const raw = headers[attemptHeader];
  const value = raw ? raw.toString() : "0";
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const handleMessageWithRetryDlq = async ({
  payload,
  handler,
  producer,
  retryTopic,
  dlqTopic,
  maxAttempts = 3,
  retryDelaysMs = [],
  attemptHeader = "x-attempt",
  errorHeader = "x-error",
  log,
  metrics,
}) => {
  const { topic, partition, message } = payload;
  const attempt = getAttempt(message.headers, attemptHeader);
  try {
    await handler({ topic, partition, message, attempt });
    return { status: "processed", attempt };
  } catch (error) {
    const nextAttempt = attempt + 1;
    const backoff = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] || 0;
    const headers = mergeHeaders(message.headers, {
      [attemptHeader]: String(nextAttempt),
      [errorHeader]: (error && error.message) || "handler_failed",
      "x-origin-topic": topic,
    });

    if (nextAttempt < maxAttempts && retryTopic) {
      if (backoff > 0) await sleep(backoff);
      await producer.send({
        topic: retryTopic,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers,
          },
        ],
      });
      metrics?.produced?.labels(retryTopic).inc();
      log?.("warn", "message forwarded to retry", {
        fromTopic: topic,
        retryTopic,
        attempt: nextAttempt,
        backoffMs: backoff,
        error: error.message,
      });
      return { status: "retried", attempt: nextAttempt };
    }

    const targetTopic = dlqTopic || retryTopic;
    await producer.send({
      topic: targetTopic,
      messages: [
        {
          key: message.key,
          value: message.value,
          headers,
        },
      ],
    });
    metrics?.produced?.labels(targetTopic).inc();
    log?.("error", "message sent to dlq", {
      fromTopic: topic,
      dlqTopic: targetTopic,
      attempt: nextAttempt,
      error: error.message,
    });
    return { status: "dead-letter", attempt: nextAttempt };
  }
};

module.exports = { handleMessageWithRetryDlq };
