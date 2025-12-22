#!/usr/bin/env node
const http = require("http");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.replace(/^--/, "");
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

const a = parseArgs();
const targetUrl =
  a.url || process.env.ORDER_URL || "http://localhost:4000/order";
const RPS = Number(a.rps || process.env.RPS || 10); // requests per second
const DURATION = Number(a.duration || process.env.DURATION || 60); // seconds
const CONCURRENCY = Number(a.concurrency || process.env.CONCURRENCY || 1);

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        // drain response
        res.on("data", () => {});
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function randomOrder() {
  const id =
    "o-" +
    Date.now().toString(36) +
    "-" +
    Math.floor(Math.random() * 1e6).toString(36);
  const amount = Number((Math.random() * 100 + 1).toFixed(2));
  const customerId = "c-" + Math.floor(Math.random() * 1000);
  return {
    orderId: id,
    amount,
    customerId,
    items: [
      {
        sku: "sku-" + Math.floor(Math.random() * 500),
        qty: Math.ceil(Math.random() * 3),
      },
    ],
  };
}

let sent = 0;
let ok = 0;
let err = 0;

console.log(
  `[load] Target: ${targetUrl}, RPS=${RPS}, duration=${DURATION}s, concurrency=${CONCURRENCY}`
);

const start = Date.now();
const endAt = start + DURATION * 1000;

const tickIntervalMs = 1000;
const perTick = Math.max(1, Math.floor((RPS * tickIntervalMs) / 1000));

const interval = setInterval(async () => {
  const now = Date.now();
  if (now >= endAt) {
    clearInterval(interval);
    // allow in-flight to finish
    setTimeout(() => {
      console.log(`[load] Done: sent=${sent}, ok=${ok}, err=${err}`);
      process.exit(0);
    }, 1000);
    return;
  }

  for (let i = 0; i < perTick; i++) {
    for (let c = 0; c < CONCURRENCY; c++) {
      const payload = randomOrder();
      sent++;
      postJson(targetUrl, payload)
        .then(() => ok++)
        .catch((e) => {
          console.error(e.message);
          err++;
        });
    }
  }
}, tickIntervalMs);

// progress log
const prog = setInterval(() => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[load] elapsed=${elapsed}s sent=${sent} ok=${ok} err=${err}`);
}, 2000);

process.on("SIGINT", () => {
  clearInterval(interval);
  clearInterval(prog);
  console.log(`[load] Interrupted. sent=${sent} ok=${ok} err=${err}`);
  process.exit(0);
});
