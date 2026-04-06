import crypto from "node:crypto";
import { Worker } from "bullmq";
import { bullRedis } from "../connection.js";
import { logger } from "../../observability/logger.js";
import { QueueName, type IntegrationJobData } from "../registry.js";

// ─── Webhook Delivery ───────────────────────────────────────────────────────
//
// This is how YOUR platform delivers webhooks to YOUR customers -- the same
// pattern Stripe, GitHub, and Twilio use to notify external systems.
//
// The flow:
// 1. A business event happens (invoice.paid, payment.succeeded, etc.)
// 2. dispatchWebhooks() finds all active subscriptions for that event
// 3. It enqueues one delivery job per subscription
// 4. This worker delivers each one with HMAC signature verification
//
// The HMAC signature lets the receiver verify the webhook came from your
// platform, not an attacker. The receiver computes HMAC-SHA256 of
// `${timestamp}.${payload}` using their secret and compares to X-Signature.
//
// If the endpoint returns non-2xx, the job throws and BullMQ retries it
// with exponential backoff (10s, 20s, 40s, ..., up to 8 attempts = ~42 min).

const DELIVERY_TIMEOUT_MS = 10_000;

async function handleDeliverWebhook(data: IntegrationJobData): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signaturePayload = `${timestamp}.${data.payload}`;
  const signature = crypto
    .createHmac("sha256", data.secret)
    .update(signaturePayload)
    .digest("hex");

  const startTime = Date.now();

  const response = await fetch(data.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
      "X-Timestamp": timestamp,
      "X-Event-Type": data.event,
      "X-Delivery-Id": data.deliveryId,
    },
    body: data.payload,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    throw new Error(
      `Webhook delivery failed: ${response.status} ${response.statusText}`,
    );
  }

  logger.info(
    {
      deliveryId: data.deliveryId,
      event: data.event,
      url: data.url,
      status: response.status,
      durationMs,
    },
    "Webhook delivered",
  );
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createWebhookWorker(): Worker<IntegrationJobData> {
  const worker = new Worker<IntegrationJobData>(
    QueueName.INTEGRATIONS,
    async (job) => {
      if (job.data.type === "deliver-webhook") {
        return handleDeliverWebhook(job.data);
      }
      throw new Error(`Unknown integration job type: ${job.data.type}`);
    },
    {
      connection: bullRedis.raw,
      concurrency: 10,
    },
  );

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, deliveryId: job.data.deliveryId },
      "Webhook delivery job completed",
    );
  });

  worker.on("failed", (job, err) => {
    logger.error(
      { jobId: job?.id, deliveryId: job?.data.deliveryId, err: err.message },
      "Webhook delivery job failed",
    );
  });

  return worker;
}
