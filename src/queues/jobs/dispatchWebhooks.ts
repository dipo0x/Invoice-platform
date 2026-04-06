import crypto from "node:crypto";
import { WebhookSubscription, type WebhookEvent } from "../../modules/webhook-subscription/webhook-subscription.model.js";
import { enqueue, QueueName } from "../registry.js";
import { logger } from "../../observability/logger.js";

// ─── Webhook Dispatcher ─────────────────────────────────────────────────────
//
// Call this from anywhere a business event occurs. It:
// 1. Queries all active webhook subscriptions for this org + event
// 2. Enqueues one delivery job per subscription
//
// Example usage:
//   await dispatchWebhooks(orgId, "invoice.paid", { invoiceId, total });
//
// The actual HTTP delivery happens in the webhook worker, not here.
// This separation means the business logic (e.g. InvoiceService.send())
// doesn't need to know about HTTP delivery, retries, or HMAC signing.

export async function dispatchWebhooks(
  orgId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await WebhookSubscription.find({
    orgId,
    status: "active",
    events: event,
  }).lean();

  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString(),
  });

  await Promise.all(
    subscriptions.map((sub) =>
      enqueue(QueueName.INTEGRATIONS, `webhook:${event}`, {
        type: "deliver-webhook",
        subscriptionId: String(sub._id),
        orgId,
        event,
        payload,
        secret: sub.secret,
        url: sub.url,
        deliveryId: crypto.randomUUID(),
      }),
    ),
  );

  logger.info(
    { orgId, event, subscriptionCount: subscriptions.length },
    "Webhook delivery jobs enqueued",
  );
}
