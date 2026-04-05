import crypto from "node:crypto";
import mongoose from "mongoose";
import { WebhookSubscription } from "./webhook-subscription.model.js";
import type {
  CreateWebhookBody,
  UpdateWebhookBody,
  ListWebhooksQuery,
} from "./webhook-subscription.schema.js";

function stripSecret(obj: Record<string, unknown>): Record<string, unknown> {
  const { secret, ...rest } = obj;
  return rest;
}

export class WebhookSubscriptionService {
  static generateSecret(): string {
    return `whsec_${crypto.randomBytes(32).toString("hex")}`;
  }

  static generateSignature(payload: string, secret: string): string {
    return crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
  }

  static async create(orgId: string, input: CreateWebhookBody) {
    const secret = this.generateSecret();

    const subscription = await WebhookSubscription.create({
      orgId: new mongoose.Types.ObjectId(orgId),
      url: input.url,
      events: input.events,
      secret,
      status: "active",
    });

    return { data: subscription.toJSON(), status: 201 };
  }

  static async getById(orgId: string, id: string) {
    const subscription = await WebhookSubscription.findOne({ _id: id, orgId });
    if (!subscription) {
      return { error: "Webhook subscription not found", status: 404 };
    }

    return { data: stripSecret(subscription.toJSON() as unknown as Record<string, unknown>), status: 200 };
  }

  static async list(orgId: string, query: ListWebhooksQuery) {
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = { orgId };

    if (query.cursor) {
      filter["_id"] = { $lt: new mongoose.Types.ObjectId(query.cursor) };
    }

    const items = await WebhookSubscription.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = items.length > limit;
    const results = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? String(results[results.length - 1]!._id) : null;

    const sanitized = results.map((r) => stripSecret(r as unknown as Record<string, unknown>));

    return {
      data: { subscriptions: sanitized, nextCursor, hasMore },
      status: 200,
    };
  }

  static async update(orgId: string, id: string, input: UpdateWebhookBody) {
    const subscription = await WebhookSubscription.findOneAndUpdate(
      { _id: id, orgId },
      input,
      { new: true },
    );

    if (!subscription) {
      return { error: "Webhook subscription not found", status: 404 };
    }

    return { data: stripSecret(subscription.toJSON() as unknown as Record<string, unknown>), status: 200 };
  }

  static async delete(orgId: string, id: string) {
    const subscription = await WebhookSubscription.findOneAndDelete({
      _id: id,
      orgId,
    });

    if (!subscription) {
      return { error: "Webhook subscription not found", status: 404 };
    }

    return { data: { message: "Webhook subscription deleted" }, status: 200 };
  }

  static async test(orgId: string, id: string) {
    const subscription = await WebhookSubscription.findOne({ _id: id, orgId });
    if (!subscription) {
      return { error: "Webhook subscription not found", status: 404 };
    }

    const testPayload = JSON.stringify({
      event: "test",
      data: { message: "This is a test webhook delivery" },
      timestamp: new Date().toISOString(),
    });

    const signature = this.generateSignature(testPayload, subscription.secret);

    try {
      const response = await fetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Event-Type": "test",
          "X-Delivery-Id": crypto.randomUUID(),
        },
        body: testPayload,
        signal: AbortSignal.timeout(10000),
      });

      return {
        data: {
          delivered: response.ok,
          statusCode: response.status,
        },
        status: 200,
      };
    } catch {
      return {
        data: {
          delivered: false,
          statusCode: null,
          error: "Failed to reach the webhook URL",
        },
        status: 200,
      };
    }
  }
}
