import { Queue } from "bullmq";
import type { DefaultJobOptions } from "bullmq";
import { bullRedis } from "./connection.js";

// ─── Queue Names ────────────────────────────────────────────────────────────

export const QueueName = {
  NOTIFICATIONS: "notifications",
  INVOICES: "invoices",
  PAYMENTS: "payments",
  INTEGRATIONS: "integrations",
} as const;

export type QueueNameType = (typeof QueueName)[keyof typeof QueueName];

// ─── Job Data Interfaces ────────────────────────────────────────────────────
//
// Every job carries a `type` discriminator so the worker knows which handler
// to call. TypeScript's discriminated union means you get autocomplete and
// exhaustiveness checking in the worker's switch statement.

// -- notifications queue --

export interface SendInvoiceEmailJob {
  type: "send-invoice-email";
  orgId: string;
  invoiceId: string;
  recipientEmail: string;
  recipientName: string;
  invoiceNumber: string;
  total: number;
  currency: string;
  dueDate: string;
}

export interface SendPaymentReceiptJob {
  type: "send-payment-receipt";
  orgId: string;
  invoiceId: string;
  paymentId: string;
  recipientEmail: string;
  recipientName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
}

export interface SendOverdueReminderJob {
  type: "send-overdue-reminder";
  orgId: string;
  invoiceId: string;
  recipientEmail: string;
  recipientName: string;
  invoiceNumber: string;
  total: number;
  currency: string;
  dueDate: string;
}

export type NotificationJobData =
  | SendInvoiceEmailJob
  | SendPaymentReceiptJob
  | SendOverdueReminderJob;

// -- invoices queue --

export interface GenerateInvoicePdfJob {
  type: "generate-invoice-pdf";
  orgId: string;
  invoiceId: string;
}

export interface CreateRecurringInvoiceJob {
  type: "create-recurring-invoice";
  orgId: string;
  recurringInvoiceId: string;
}

export interface ScanRecurringInvoicesJob {
  type: "scan-recurring-invoices";
}

export interface CheckOverdueInvoicesJob {
  type: "check-overdue-invoices";
}

export type InvoiceJobData =
  | GenerateInvoicePdfJob
  | CreateRecurringInvoiceJob
  | ScanRecurringInvoicesJob
  | CheckOverdueInvoicesJob;

// -- payments queue --

export interface ProcessRefundJob {
  type: "process-refund";
  orgId: string;
  paymentId: string;
  amount?: number;
}

export interface SyncPaymentStatusJob {
  type: "sync-payment-status";
  stripePaymentIntentId: string;
}

export interface ReconcilePaymentJob {
  type: "reconcile-payment";
  paymentId: string;
  stripeSessionId: string;
}

export type PaymentJobData = ProcessRefundJob | SyncPaymentStatusJob | ReconcilePaymentJob;

// -- integrations queue --

export interface DeliverWebhookJob {
  type: "deliver-webhook";
  subscriptionId: string;
  orgId: string;
  event: string;
  payload: string;
  secret: string;
  url: string;
  deliveryId: string;
}

export type IntegrationJobData = DeliverWebhookJob;

// ─── Queue ↔ Job Data Map ───────────────────────────────────────────────────
//
// This lets getQueue() and enqueue() enforce that the correct job data type
// is used for each queue at compile time.

export interface QueueJobDataMap {
  notifications: NotificationJobData;
  invoices: InvoiceJobData;
  payments: PaymentJobData;
  integrations: IntegrationJobData;
}

// ─── Retry / Backoff Configs ────────────────────────────────────────────────
//
// Each queue gets a different retry strategy because the failure modes differ:
//   - notifications: email provider hiccup, retry fast (5s exponential)
//   - invoices: PDF gen or DB issue, slightly longer (10s exponential)
//   - payments: Stripe outage, wait longer between retries (15s exponential, 5 attempts)
//   - integrations: external webhook endpoint down, many retries (10s exponential, 8 attempts)

const defaultJobOptions: Record<QueueNameType, DefaultJobOptions> = {
  [QueueName.NOTIFICATIONS]: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
  [QueueName.INVOICES]: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
  [QueueName.PAYMENTS]: {
    attempts: 5,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 604_800 },
    removeOnFail: { age: 2_592_000 },
  },
  [QueueName.INTEGRATIONS]: {
    attempts: 8,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 604_800 },
  },
};

// ─── Queue Factory (singleton cache) ────────────────────────────────────────

const queueCache = new Map<string, Queue>();

export function getQueue<N extends QueueNameType>(
  name: N,
): Queue<QueueJobDataMap[N]> {
  let queue = queueCache.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: bullRedis.raw,
      defaultJobOptions: defaultJobOptions[name],
    });
    queueCache.set(name, queue);
  }
  return queue as Queue<QueueJobDataMap[N]>;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(
    Array.from(queueCache.values()).map((q) => q.close()),
  );
  queueCache.clear();
}

// ─── Type-safe enqueue helper ───────────────────────────────────────────────

export async function enqueue<N extends QueueNameType>(
  queueName: N,
  jobName: string,
  data: QueueJobDataMap[N],
  opts?: Partial<DefaultJobOptions>,
): Promise<void> {
  const queue = getQueue(queueName);
  await (queue as Queue).add(jobName, data, opts);
}
