import { Worker } from "bullmq";
import { bullRedis } from "../connection.js";
import { stripe } from "../../config/stripe.config.js";
import { logger } from "../../observability/logger.js";
import { Payment } from "../../modules/payment/payment.model.js";
import { Invoice } from "../../modules/invoice/invoice.model.js";
import { Client } from "../../modules/client/client.model.js";
import { enqueue, QueueName } from "../registry.js";
import { dispatchWebhooks } from "../jobs/dispatchWebhooks.js";
import type {
  PaymentJobData,
  ProcessRefundJob,
  SyncPaymentStatusJob,
} from "../registry.js";

// ─── Refund Handler ─────────────────────────────────────────────────────────
//
// Previously, refunds were processed synchronously in the HTTP handler.
// Now the HTTP handler validates the request and enqueues this job, returning
// 202 Accepted immediately. The actual Stripe API call happens here.
//
// Why? Stripe calls can take 2-5 seconds. If Stripe is slow or down, the user
// waits. With a queue, the API responds instantly and the refund is retried
// automatically if Stripe is temporarily unavailable.

async function handleProcessRefund(data: ProcessRefundJob): Promise<void> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const payment = await Payment.findOne({ _id: data.paymentId, orgId: data.orgId });
  if (!payment) {
    logger.warn({ paymentId: data.paymentId }, "Payment not found for refund");
    return;
  }

  if (payment.status !== "succeeded") {
    logger.warn({ paymentId: data.paymentId, status: payment.status }, "Cannot refund non-succeeded payment");
    return;
  }

  if (!payment.stripePaymentIntentId) {
    throw new Error("No Stripe payment intent associated with this payment");
  }

  const refundParams: { payment_intent: string; amount?: number } = {
    payment_intent: payment.stripePaymentIntentId,
  };

  if (data.amount) {
    refundParams.amount = Math.round(data.amount * 100);
  }

  await stripe.refunds.create(refundParams);

  const isFullRefund = !data.amount || data.amount >= payment.amount;

  await Payment.findByIdAndUpdate(data.paymentId, {
    status: isFullRefund ? "refunded" : "succeeded",
  });

  if (isFullRefund) {
    await Invoice.findByIdAndUpdate(payment.invoiceId, { status: "sent" });
  }

  // Notify subscribers
  await dispatchWebhooks(data.orgId, "payment.failed", {
    paymentId: String(payment._id),
    invoiceId: String(payment.invoiceId),
    amount: data.amount ?? payment.amount,
    type: isFullRefund ? "full_refund" : "partial_refund",
  });

  // Send receipt email
  const invoice = await Invoice.findById(payment.invoiceId).lean();
  const client = invoice ? await Client.findById(invoice.clientId).lean() : null;
  if (client?.email && invoice) {
    await enqueue(QueueName.NOTIFICATIONS, "payment-receipt", {
      type: "send-payment-receipt",
      orgId: data.orgId,
      invoiceId: String(payment.invoiceId),
      paymentId: String(payment._id),
      recipientEmail: client.email,
      recipientName: client.name,
      invoiceNumber: invoice.invoiceNumber,
      amount: data.amount ?? payment.amount,
      currency: payment.currency,
    });
  }

  logger.info(
    { paymentId: data.paymentId, amount: data.amount, isFullRefund },
    "Refund processed",
  );
}

// ─── Sync Payment Status ────────────────────────────────────────────────────
//
// Sometimes the local payment status can drift from Stripe's truth (network
// failures, missed webhooks). This job fetches the PaymentIntent from Stripe
// and reconciles the local record.

async function handleSyncPaymentStatus(data: SyncPaymentStatusJob): Promise<void> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(data.stripePaymentIntentId);

  const payment = await Payment.findOne({
    stripePaymentIntentId: data.stripePaymentIntentId,
  });

  if (!payment) {
    logger.warn({ stripePaymentIntentId: data.stripePaymentIntentId }, "No local payment found for sync");
    return;
  }

  const statusMap: Record<string, string> = {
    succeeded: "succeeded",
    canceled: "failed",
    requires_payment_method: "failed",
  };

  const mappedStatus = statusMap[paymentIntent.status];
  if (mappedStatus && mappedStatus !== payment.status) {
    await Payment.findByIdAndUpdate(payment._id, {
      status: mappedStatus,
      ...(mappedStatus === "succeeded" ? { paidAt: new Date() } : {}),
    });

    if (mappedStatus === "succeeded") {
      await Invoice.findOneAndUpdate(
        { _id: payment.invoiceId, status: { $ne: "paid" } },
        { status: "paid", paidAt: new Date() },
      );
    }

    logger.info(
      { paymentId: String(payment._id), oldStatus: payment.status, newStatus: mappedStatus },
      "Payment status synced from Stripe",
    );
  }
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createPaymentWorker(): Worker<PaymentJobData> {
  const worker = new Worker<PaymentJobData>(
    QueueName.PAYMENTS,
    async (job) => {
      switch (job.data.type) {
        case "process-refund":
          return handleProcessRefund(job.data);
        case "sync-payment-status":
          return handleSyncPaymentStatus(job.data);
        default: {
          const _exhaustive: never = job.data;
          throw new Error(`Unknown payment job type: ${(_exhaustive as PaymentJobData).type}`);
        }
      }
    },
    {
      connection: bullRedis.raw,
      concurrency: 2,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Payment job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data.type, err: err.message }, "Payment job failed");
  });

  return worker;
}
