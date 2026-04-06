import { Worker } from "bullmq";
import PDFDocument from "pdfkit";
import { bullRedis } from "../connection.js";
import { logger } from "../../observability/logger.js";
import { config } from "../../config/index.config.js";
import { Invoice } from "../../modules/invoice/invoice.model.js";
import { Client } from "../../modules/client/client.model.js";
import { RecurringInvoice } from "../../modules/recurring-invoice/recurring-invoice.model.js";
import { InvoiceService } from "../../modules/invoice/invoice.service.js";
import { enqueue, QueueName } from "../registry.js";
import type {
  InvoiceJobData,
  GenerateInvoicePdfJob,
  CreateRecurringInvoiceJob,
} from "../registry.js";

// ─── PDF Generation ─────────────────────────────────────────────────────────
//
// PDFKit builds the PDF in memory using a stream. We collect the chunks
// into a Buffer, then base64-encode it. The result can be attached to an
// email or stored in object storage later.
//
// This runs in a BullMQ worker (not the HTTP handler) because PDF generation
// is CPU-bound -- it would block the event loop and slow down API responses
// for other users if it ran inline.

function generatePdfBuffer(invoice: Record<string, unknown>, clientName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(24).text("INVOICE", { align: "right" });
    doc.moveDown();
    doc.fontSize(12).text(`Invoice #: ${invoice["invoiceNumber"]}`, { align: "right" });
    doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: "right" });
    doc.text(`Due: ${new Date(invoice["dueDate"] as string).toLocaleDateString()}`, { align: "right" });
    doc.text(`Status: ${invoice["status"]}`, { align: "right" });
    doc.moveDown();

    // Bill To
    doc.fontSize(14).text("Bill To:");
    doc.fontSize(12).text(clientName);
    doc.moveDown();

    // Line Items Header
    const tableTop = doc.y;
    doc.font("Helvetica-Bold");
    doc.text("Description", 50, tableTop);
    doc.text("Qty", 300, tableTop, { width: 60, align: "right" });
    doc.text("Price", 370, tableTop, { width: 80, align: "right" });
    doc.text("Amount", 460, tableTop, { width: 80, align: "right" });
    doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke();
    doc.font("Helvetica");

    // Line Items
    let y = tableTop + 25;
    const lineItems = invoice["lineItems"] as Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    }>;

    for (const item of lineItems) {
      doc.text(item.description, 50, y);
      doc.text(String(item.quantity), 300, y, { width: 60, align: "right" });
      doc.text(item.unitPrice.toFixed(2), 370, y, { width: 80, align: "right" });
      doc.text(item.amount.toFixed(2), 460, y, { width: 80, align: "right" });
      y += 20;
    }

    // Totals
    doc.moveTo(370, y + 5).lineTo(540, y + 5).stroke();
    y += 15;
    doc.text(`Subtotal:`, 370, y, { width: 80, align: "right" });
    doc.text(`${(invoice["subtotal"] as number).toFixed(2)}`, 460, y, { width: 80, align: "right" });
    y += 20;
    doc.text(`Tax (${invoice["taxRate"]}%):`, 370, y, { width: 80, align: "right" });
    doc.text(`${(invoice["taxAmount"] as number).toFixed(2)}`, 460, y, { width: 80, align: "right" });
    y += 20;
    doc.font("Helvetica-Bold");
    doc.text(`Total:`, 370, y, { width: 80, align: "right" });
    doc.text(`${invoice["currency"]} ${(invoice["total"] as number).toFixed(2)}`, 460, y, { width: 80, align: "right" });

    // Notes
    if (invoice["notes"]) {
      doc.font("Helvetica");
      doc.moveDown(3);
      doc.text(`Notes: ${invoice["notes"]}`, 50);
    }

    // Payment link
    doc.moveDown(2);
    doc.font("Helvetica");
    doc.text(`Pay online: ${config.APP_URL}/v1/invoices/${invoice["_id"]}/pay`, 50);

    doc.end();
  });
}

async function handleGenerateInvoicePdf(data: GenerateInvoicePdfJob): Promise<void> {
  const invoice = await Invoice.findOne({ _id: data.invoiceId, orgId: data.orgId }).lean();
  if (!invoice) {
    logger.warn({ invoiceId: data.invoiceId }, "Invoice not found for PDF generation");
    return;
  }

  const client = await Client.findById(invoice.clientId).lean();
  const clientName = client?.name ?? "Unknown Client";

  const pdfBuffer = await generatePdfBuffer(
    invoice as unknown as Record<string, unknown>,
    clientName,
  );

  logger.info(
    { invoiceId: data.invoiceId, pdfSizeBytes: pdfBuffer.length },
    "Invoice PDF generated",
  );

  // Enqueue the invoice email with the PDF attached
  if (client?.email) {
    await enqueue(QueueName.NOTIFICATIONS, "send-invoice-email", {
      type: "send-invoice-email",
      orgId: data.orgId,
      invoiceId: data.invoiceId,
      recipientEmail: client.email,
      recipientName: clientName,
      invoiceNumber: invoice.invoiceNumber,
      total: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString(),
    });
  }
}

// ─── Recurring Invoice Creation ─────────────────────────────────────────────
//
// When a recurring invoice is due, this handler:
// 1. Loads the template
// 2. Creates a real invoice from it via InvoiceService.create()
// 3. Updates the template's lastRunAt and nextRunAt
// 4. Queues PDF generation (which will also queue the email)
//
// This is the "materializer" -- it turns a template into a real invoice.

async function handleCreateRecurringInvoice(data: CreateRecurringInvoiceJob): Promise<void> {
  const template = await RecurringInvoice.findOne({
    _id: data.recurringInvoiceId,
    orgId: data.orgId,
    status: "active",
  });

  if (!template) {
    logger.warn({ recurringInvoiceId: data.recurringInvoiceId }, "Recurring template not found or inactive");
    return;
  }

  // Check if endDate has passed
  if (template.endDate && template.endDate < new Date()) {
    await RecurringInvoice.findByIdAndUpdate(template._id, { status: "cancelled" });
    logger.info({ recurringInvoiceId: data.recurringInvoiceId }, "Recurring invoice expired, cancelled");
    return;
  }

  // Due date = 30 days from now
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const result = await InvoiceService.create(String(template.orgId), {
    clientId: String(template.clientId),
    lineItems: template.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    })),
    taxRate: template.taxRate,
    currency: template.currency,
    dueDate: dueDate.toISOString(),
    notes: template.notes,
  });

  if (result.error) {
    throw new Error(`Failed to create invoice from recurring template: ${result.error}`);
  }

  const invoice = result.data as unknown as { _id: string };

  // Update template scheduling
  const nextRunAt = computeNextRunAt(new Date(), template.frequency);
  await RecurringInvoice.findByIdAndUpdate(template._id, {
    lastRunAt: new Date(),
    nextRunAt,
  });

  // Queue PDF generation + email for the new invoice
  await enqueue(QueueName.INVOICES, "generate-pdf", {
    type: "generate-invoice-pdf",
    orgId: data.orgId,
    invoiceId: String(invoice._id),
  });

  logger.info(
    { recurringInvoiceId: data.recurringInvoiceId, newInvoiceId: invoice._id },
    "Recurring invoice materialized",
  );
}

function computeNextRunAt(from: Date, frequency: string): Date {
  const next = new Date(from);
  switch (frequency) {
    case "weekly":
      next.setDate(next.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + 1);
      break;
    case "quarterly":
      next.setMonth(next.getMonth() + 3);
      break;
    case "yearly":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

// ─── Scan for Due Recurring Invoices ────────────────────────────────────────
//
// This runs on a cron (every 15 minutes). It finds all recurring templates
// whose nextRunAt is in the past and enqueues a creation job for each one.
// This pattern (scanner + individual jobs) is better than processing them
// all in one job because each creation is independently retriable.

async function handleScanRecurringInvoices(): Promise<void> {
  const dueTemplates = await RecurringInvoice.find({
    status: "active",
    nextRunAt: { $lte: new Date() },
  }).lean();

  logger.info({ count: dueTemplates.length }, "Found due recurring invoices");

  for (const template of dueTemplates) {
    await enqueue(QueueName.INVOICES, "create-recurring", {
      type: "create-recurring-invoice",
      orgId: String(template.orgId),
      recurringInvoiceId: String(template._id),
    });
  }
}

// ─── Check Overdue Invoices ─────────────────────────────────────────────────
//
// Runs hourly. Finds invoices past their due date that haven't been paid
// and transitions them to "overdue". Then enqueues reminder emails.

async function handleCheckOverdueInvoices(): Promise<void> {
  const overdueInvoices = await Invoice.find({
    status: { $in: ["sent", "viewed", "partially_paid"] },
    dueDate: { $lt: new Date() },
  }).lean();

  logger.info({ count: overdueInvoices.length }, "Found overdue invoices");

  for (const invoice of overdueInvoices) {
    await Invoice.findOneAndUpdate(
      { _id: invoice._id, status: { $ne: "overdue" } },
      { status: "overdue" },
    );

    const client = await Client.findById(invoice.clientId).lean();
    if (client?.email) {
      await enqueue(QueueName.NOTIFICATIONS, "overdue-reminder", {
        type: "send-overdue-reminder",
        orgId: String(invoice.orgId),
        invoiceId: String(invoice._id),
        recipientEmail: client.email,
        recipientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        total: invoice.total,
        currency: invoice.currency,
        dueDate: invoice.dueDate.toISOString(),
      });
    }
  }
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export function createInvoiceWorker(): Worker<InvoiceJobData> {
  const worker = new Worker<InvoiceJobData>(
    QueueName.INVOICES,
    async (job) => {
      switch (job.data.type) {
        case "generate-invoice-pdf":
          return handleGenerateInvoicePdf(job.data);
        case "create-recurring-invoice":
          return handleCreateRecurringInvoice(job.data);
        case "scan-recurring-invoices":
          return handleScanRecurringInvoices();
        case "check-overdue-invoices":
          return handleCheckOverdueInvoices();
        default: {
          const _exhaustive: never = job.data;
          throw new Error(`Unknown invoice job type: ${(_exhaustive as InvoiceJobData).type}`);
        }
      }
    },
    {
      connection: bullRedis.raw,
      concurrency: 3,
    },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Invoice job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, type: job?.data.type, err: err.message }, "Invoice job failed");
  });

  return worker;
}
