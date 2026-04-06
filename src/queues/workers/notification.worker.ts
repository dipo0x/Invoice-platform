import { Worker } from "bullmq";
import { bullRedis } from "../connection.js";
import { resend } from "../../config/resend.config.js";
import { config } from "../../config/index.config.js";
import { logger } from "../../observability/logger.js";
import {
  QueueName,
  type NotificationJobData,
  type SendInvoiceEmailJob,
  type SendPaymentReceiptJob,
  type SendOverdueReminderJob,
} from "../registry.js";

// ─── Email Handlers ─────────────────────────────────────────────────────────
//
// Each handler builds an HTML email and sends it via Resend.
// If Resend isn't configured (no API key), the job logs a warning and succeeds
// silently so the queue doesn't fill up with retries in development.

async function handleSendInvoiceEmail(data: SendInvoiceEmailJob): Promise<void> {
  if (!resend) {
    logger.warn({ invoiceId: data.invoiceId }, "Resend not configured, skipping invoice email");
    return;
  }

  const paymentUrl = `${config.APP_URL}/v1/invoices/${data.invoiceId}/pay`;

  await resend.emails.send({
    from: config.RESEND_FROM_EMAIL,
    to: data.recipientEmail,
    subject: `Invoice ${data.invoiceNumber} - ${data.currency} ${data.total.toFixed(2)}`,
    html: `
      <h2>Invoice ${data.invoiceNumber}</h2>
      <p>Hi ${data.recipientName},</p>
      <p>You have a new invoice for <strong>${data.currency} ${data.total.toFixed(2)}</strong>.</p>
      <p>Due date: ${new Date(data.dueDate).toLocaleDateString()}</p>
      <p><a href="${paymentUrl}">Pay Now</a></p>
      <p>Thank you for your business.</p>
    `,
  });

  logger.info({ invoiceId: data.invoiceId, to: data.recipientEmail }, "Invoice email sent");
}

async function handleSendPaymentReceipt(data: SendPaymentReceiptJob): Promise<void> {
  if (!resend) {
    logger.warn({ paymentId: data.paymentId }, "Resend not configured, skipping receipt email");
    return;
  }

  await resend.emails.send({
    from: config.RESEND_FROM_EMAIL,
    to: data.recipientEmail,
    subject: `Payment received for Invoice ${data.invoiceNumber}`,
    html: `
      <h2>Payment Confirmation</h2>
      <p>Hi ${data.recipientName},</p>
      <p>We received your payment of <strong>${data.currency} ${data.amount.toFixed(2)}</strong>
         for invoice ${data.invoiceNumber}.</p>
      <p>Thank you!</p>
    `,
  });

  logger.info({ paymentId: data.paymentId, to: data.recipientEmail }, "Payment receipt sent");
}

async function handleSendOverdueReminder(data: SendOverdueReminderJob): Promise<void> {
  if (!resend) {
    logger.warn({ invoiceId: data.invoiceId }, "Resend not configured, skipping overdue reminder");
    return;
  }

  const paymentUrl = `${config.APP_URL}/v1/invoices/${data.invoiceId}/pay`;

  await resend.emails.send({
    from: config.RESEND_FROM_EMAIL,
    to: data.recipientEmail,
    subject: `OVERDUE: Invoice ${data.invoiceNumber} - ${data.currency} ${data.total.toFixed(2)}`,
    html: `
      <h2>Invoice ${data.invoiceNumber} is Overdue</h2>
      <p>Hi ${data.recipientName},</p>
      <p>Your invoice for <strong>${data.currency} ${data.total.toFixed(2)}</strong>
         was due on ${new Date(data.dueDate).toLocaleDateString()} and remains unpaid.</p>
      <p><a href="${paymentUrl}">Pay Now</a></p>
      <p>Please arrange payment at your earliest convenience.</p>
    `,
  });

  logger.info({ invoiceId: data.invoiceId, to: data.recipientEmail }, "Overdue reminder sent");
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createNotificationWorker(): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    QueueName.NOTIFICATIONS,
    async (job) => {
      switch (job.data.type) {
        case "send-invoice-email":
          return handleSendInvoiceEmail(job.data);
        case "send-payment-receipt":
          return handleSendPaymentReceipt(job.data);
        case "send-overdue-reminder":
          return handleSendOverdueReminder(job.data);
        default: {
          const _exhaustive: never = job.data;
          throw new Error(`Unknown notification job type: ${(_exhaustive as NotificationJobData).type}`);
        }
      }
    },
    {
      connection: bullRedis.raw,
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Notification job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data.type, err: err.message }, "Notification job failed");
  });

  return worker;
}
