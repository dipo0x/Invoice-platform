import mongoose from "mongoose";
import { Invoice, type InvoiceStatus } from "./invoice.model.js";
import { Client } from "../client/client.model.js";
import { enqueue, QueueName } from "../../queues/registry.js";
import { dispatchWebhooks } from "../../queues/jobs/dispatchWebhooks.js";
import { SpanStatusCode } from "@opentelemetry/api";
import type {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  ListInvoicesQuery,
} from "./invoice.schema.js";
import { tracer } from "../../observability/tracer.js";
import { invoicesCreatedTotal } from "../../observability/metrics.js";

// Valid state transitions
const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["viewed", "paid", "partially_paid", "overdue", "cancelled"],
  viewed: ["paid", "partially_paid", "overdue", "cancelled"],
  partially_paid: ["paid", "overdue", "cancelled"],
  overdue: ["paid", "partially_paid", "cancelled"],
  paid: [],
  cancelled: [],
};

function calculateTotals(
  lineItems: { description: string; quantity: number; unitPrice: number }[],
  taxRate: number,
) {
  const computed = lineItems.map((item) => ({
    ...item,
    amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));

  const subtotal = computed.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;

  return { lineItems: computed, subtotal, taxAmount, total };
}

const MAX_INVOICE_NUMBER_RETRIES = 10;

function isDuplicateInvoiceNumberError(err: unknown): boolean {
  const duplicateKeyError = err as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
    message?: string;
  };

  if (duplicateKeyError.code !== 11000) {
    return false;
  }

  return Boolean(
    duplicateKeyError.keyPattern?.["invoiceNumber"] !== undefined ||
    duplicateKeyError.keyValue?.["invoiceNumber"] !== undefined ||
    duplicateKeyError.message?.includes("invoiceNumber"),
  );
}

async function generateInvoiceNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await Invoice.countDocuments({
    orgId,
    invoiceNumber: { $regex: `^INV-${year}-` },
  });
  const number = String(count + 1).padStart(4, "0");
  return `INV-${year}-${number}`;
}

export class InvoiceService {
  static async create(orgId: string, input: CreateInvoiceBody) {
    return tracer.startActiveSpan("invoice.create", async (span) => {
      span.setAttributes({ "invoice.org_id": orgId, "invoice.client_id": input.clientId });

      try {
        // Verify client belongs to this org
        const client = await Client.findOne({
          _id: input.clientId,
          orgId,
          deletedAt: null,
        });
        if (!client) {
          span.end();
          return { error: "Client not found", status: 404 };
        }

        const taxRate = input.taxRate ?? 0;
        const { lineItems, subtotal, taxAmount, total } = calculateTotals(
          input.lineItems,
          taxRate,
        );
        let invoice;
        let invoiceNumber = "";

        for (let attempt = 0; attempt < MAX_INVOICE_NUMBER_RETRIES; attempt += 1) {
          try {
            invoiceNumber = await generateInvoiceNumber(orgId);
            invoice = await Invoice.create({
              orgId: new mongoose.Types.ObjectId(orgId),
              clientId: new mongoose.Types.ObjectId(input.clientId),
              invoiceNumber,
              status: "draft",
              lineItems,
              subtotal,
              taxRate,
              taxAmount,
              total,
              currency: input.currency ?? "USD",
              dueDate: new Date(input.dueDate),
              notes: input.notes,
            });
            break;
          } catch (err) {
            if (
              attempt < MAX_INVOICE_NUMBER_RETRIES - 1 &&
              isDuplicateInvoiceNumberError(err)
            ) {
              continue;
            }
            throw err;
          }
        }

        if (!invoice) {
          throw new Error("Failed to create invoice after retrying duplicate invoice numbers");
        }

        span.setAttributes({
          "invoice.id": String(invoice._id),
          "invoice.number": invoiceNumber,
          "invoice.total": total,
          "invoice.currency": input.currency ?? "USD",
        });

        invoicesCreatedTotal.inc({ org_id: orgId, status: "draft" });

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return { data: invoice.toJSON(), status: 201 };
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        span.end();
        throw err;
      }
    });
  }

  static async getById(orgId: string, invoiceId: string) {
    const invoice = await Invoice.findOne({ _id: invoiceId, orgId });
    if (!invoice) {
      return { error: "Invoice not found", status: 404 };
    }

    return { data: invoice.toJSON(), status: 200 };
  }

  static async list(orgId: string, query: ListInvoicesQuery) {
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = { orgId };

    if (query.cursor) {
      filter["_id"] = { $lt: new mongoose.Types.ObjectId(query.cursor) };
    }

    if (query.status) {
      filter["status"] = query.status;
    }

    if (query.clientId) {
      filter["clientId"] = query.clientId;
    }

    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter["$gte"] = new Date(query.from);
      if (query.to) dateFilter["$lte"] = new Date(query.to);
      filter["createdAt"] = dateFilter;
    }

    const invoices = await Invoice.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = invoices.length > limit;
    const results = hasMore ? invoices.slice(0, limit) : invoices;
    const nextCursor = hasMore ? String(results[results.length - 1]!._id) : null;

    return {
      data: { invoices: results, nextCursor, hasMore },
      status: 200,
    };
  }

  static async update(orgId: string, invoiceId: string, input: UpdateInvoiceBody) {
    const invoice = await Invoice.findOne({ _id: invoiceId, orgId });
    if (!invoice) {
      return { error: "Invoice not found", status: 404 };
    }

    if (invoice.status !== "draft") {
      return { error: "Only draft invoices can be updated", status: 400 };
    }

    const taxRate = input.taxRate ?? invoice.taxRate;
    const rawLineItems = input.lineItems ?? invoice.lineItems;
    const { lineItems, subtotal, taxAmount, total } = calculateTotals(
      rawLineItems,
      taxRate,
    );

    const updated = await Invoice.findByIdAndUpdate(
      invoiceId,
      {
        lineItems,
        subtotal,
        taxRate,
        taxAmount,
        total,
        ...(input.dueDate && { dueDate: new Date(input.dueDate) }),
        ...(input.notes !== undefined && { notes: input.notes }),
      },
      { new: true },
    );

    return { data: updated!.toJSON(), status: 200 };
  }

  static async send(orgId: string, invoiceId: string) {
    const result = await this.transition(orgId, invoiceId, "sent", { sentAt: new Date() });

    if (result.data) {
      // Queue PDF generation (which also queues the email)
      await enqueue(QueueName.INVOICES, "generate-pdf", {
        type: "generate-invoice-pdf",
        orgId,
        invoiceId,
      });

      // Notify webhook subscribers
      const invoiceData = result.data as unknown as Record<string, unknown>;
      await dispatchWebhooks(orgId, "invoice.sent", {
        invoiceId,
        invoiceNumber: invoiceData["invoiceNumber"],
      });
    }

    return result;
  }

  static async markViewed(orgId: string, invoiceId: string) {
    return this.transition(orgId, invoiceId, "viewed", { viewedAt: new Date() });
  }

  static async cancel(orgId: string, invoiceId: string) {
    return this.transition(orgId, invoiceId, "cancelled");
  }

  private static async transition(
    orgId: string,
    invoiceId: string,
    targetStatus: InvoiceStatus,
    extraFields: Record<string, unknown> = {},
  ) {
    // Build the list of valid source statuses for the target
    const validFromStatuses = Object.entries(VALID_TRANSITIONS)
      .filter(([, targets]) => targets.includes(targetStatus))
      .map(([source]) => source);

    if (validFromStatuses.length === 0) {
      return { error: `No valid transition to "${targetStatus}"`, status: 400 };
    }

    // Atomic: only update if the current status allows this transition
    const updated = await Invoice.findOneAndUpdate(
      { _id: invoiceId, orgId, status: { $in: validFromStatuses } },
      { status: targetStatus, ...extraFields },
      { new: true },
    );

    if (!updated) {
      // Determine why it failed: not found or invalid transition
      const exists = await Invoice.findOne({ _id: invoiceId, orgId });
      if (!exists) {
        return { error: "Invoice not found", status: 404 };
      }
      return {
        error: `Cannot transition from "${exists.status}" to "${targetStatus}"`,
        status: 400,
      };
    }

    return { data: updated!.toJSON(), status: 200 };
  }
}
