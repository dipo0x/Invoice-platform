import mongoose from "mongoose";
import { RecurringInvoice, type Frequency } from "./recurring-invoice.model.js";
import { Client } from "../client/client.model.js";
import type {
  CreateRecurringBody,
  UpdateRecurringBody,
  ListRecurringQuery,
} from "./recurring-invoice.schema.js";

function computeNextRunAt(startDate: Date, frequency: Frequency): Date {
  const next = new Date(startDate);
  const now = new Date();

  // Advance until the next run is in the future
  while (next <= now) {
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
  }

  return next;
}

export class RecurringInvoiceService {
  static async create(orgId: string, input: CreateRecurringBody) {
    const client = await Client.findOne({
      _id: input.clientId,
      orgId,
      deletedAt: null,
    });
    if (!client) {
      return { error: "Client not found", status: 404 };
    }

    const startDate = new Date(input.startDate);
    const nextRunAt = computeNextRunAt(startDate, input.frequency);

    const recurring = await RecurringInvoice.create({
      orgId: new mongoose.Types.ObjectId(orgId),
      clientId: new mongoose.Types.ObjectId(input.clientId),
      lineItems: input.lineItems,
      frequency: input.frequency,
      taxRate: input.taxRate ?? 0,
      currency: input.currency ?? "USD",
      status: "active",
      startDate,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      nextRunAt,
      notes: input.notes,
    });

    return { data: recurring.toJSON(), status: 201 };
  }

  static async getById(orgId: string, id: string) {
    const recurring = await RecurringInvoice.findOne({ _id: id, orgId });
    if (!recurring) {
      return { error: "Recurring invoice not found", status: 404 };
    }

    return { data: recurring.toJSON(), status: 200 };
  }

  static async list(orgId: string, query: ListRecurringQuery) {
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = { orgId };

    if (query.cursor) {
      filter["_id"] = { $lt: new mongoose.Types.ObjectId(query.cursor) };
    }

    if (query.status) {
      filter["status"] = query.status;
    }

    const items = await RecurringInvoice.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? String(results[results.length - 1]!._id) : null;

    return {
      data: { recurringInvoices: results, nextCursor, hasMore },
      status: 200,
    };
  }

  static async update(orgId: string, id: string, input: UpdateRecurringBody) {
    const recurring = await RecurringInvoice.findOne({ _id: id, orgId });
    if (!recurring) {
      return { error: "Recurring invoice not found", status: 404 };
    }

    if (recurring.status === "cancelled") {
      return { error: "Cannot update a cancelled recurring invoice", status: 400 };
    }

    const updateData: Record<string, unknown> = { ...input };

    // Recompute nextRunAt if frequency changed
    if (input.frequency && input.frequency !== recurring.frequency) {
      updateData["nextRunAt"] = computeNextRunAt(
        recurring.startDate,
        input.frequency,
      );
    }

    if (input.endDate) {
      updateData["endDate"] = new Date(input.endDate);
    }

    const updated = await RecurringInvoice.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    return { data: updated!.toJSON(), status: 200 };
  }

  static async pause(orgId: string, id: string) {
    const recurring = await RecurringInvoice.findOne({ _id: id, orgId });
    if (!recurring) {
      return { error: "Recurring invoice not found", status: 404 };
    }

    if (recurring.status !== "active") {
      return { error: "Only active recurring invoices can be paused", status: 400 };
    }

    const updated = await RecurringInvoice.findByIdAndUpdate(
      id,
      { status: "paused" },
      { new: true },
    );

    return { data: updated!.toJSON(), status: 200 };
  }

  static async resume(orgId: string, id: string) {
    const recurring = await RecurringInvoice.findOne({ _id: id, orgId });
    if (!recurring) {
      return { error: "Recurring invoice not found", status: 404 };
    }

    if (recurring.status !== "paused") {
      return { error: "Only paused recurring invoices can be resumed", status: 400 };
    }

    const nextRunAt = computeNextRunAt(recurring.startDate, recurring.frequency);

    const updated = await RecurringInvoice.findByIdAndUpdate(
      id,
      { status: "active", nextRunAt },
      { new: true },
    );

    return { data: updated!.toJSON(), status: 200 };
  }

  static async cancel(orgId: string, id: string) {
    const recurring = await RecurringInvoice.findOne({ _id: id, orgId });
    if (!recurring) {
      return { error: "Recurring invoice not found", status: 404 };
    }

    if (recurring.status === "cancelled") {
      return { error: "Recurring invoice is already cancelled", status: 400 };
    }

    const updated = await RecurringInvoice.findByIdAndUpdate(
      id,
      { status: "cancelled", nextRunAt: null },
      { new: true },
    );

    return { data: updated!.toJSON(), status: 200 };
  }
}
