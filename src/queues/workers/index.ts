import type { Worker } from "bullmq";
import { createNotificationWorker } from "./notification.worker.js";
import { createInvoiceWorker } from "./invoice.worker.js";
import { createPaymentWorker } from "./payment.worker.js";
import { createWebhookWorker } from "./webhook.worker.js";
import { getQueue, QueueName } from "../registry.js";
import { logger } from "../../observability/logger.js";

// ─── Worker Orchestrator ────────────────────────────────────────────────────
//
// This is the single place that starts and stops all queue workers.
// Called from main.ts during startup and shutdown.
//
// Startup order doesn't matter for workers (they're independent consumers),
// but shutdown order matters: workers must finish current jobs before we
// close the queue instances and Redis connection.

const workers: Worker[] = [];

export async function startAllWorkers(): Promise<void> {
  workers.push(
    createNotificationWorker(),
    createInvoiceWorker(),
    createPaymentWorker(),
    createWebhookWorker(),
  );

  // ── Register cron/repeatable jobs ──
  //
  // BullMQ repeatable jobs are stored in Redis. If the job already exists
  // (same jobId), addding it again is a no-op. This makes it safe to call
  // on every startup without creating duplicates.

  const invoiceQueue = getQueue(QueueName.INVOICES);

  // Check for overdue invoices every hour
  await invoiceQueue.add(
    "check-overdue",
    { type: "check-overdue-invoices" },
    { repeat: { pattern: "0 * * * *" }, jobId: "check-overdue-cron" },
  );

  // Scan for due recurring invoices every 15 minutes
  await invoiceQueue.add(
    "scan-recurring",
    { type: "scan-recurring-invoices" },
    { repeat: { pattern: "*/15 * * * *" }, jobId: "scan-recurring-cron" },
  );

  logger.info({ workerCount: workers.length }, "All queue workers started");
}

export async function stopAllWorkers(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  workers.length = 0;
  logger.info("All queue workers stopped");
}
