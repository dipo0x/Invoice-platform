import { z } from "zod";

const webhookIdParams = z.object({
  id: z.string().min(1, "Webhook subscription ID is required"),
});

const webhookEvents = z.enum([
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.overdue",
  "invoice.cancelled",
  "payment.succeeded",
  "payment.failed",
]);

export const createWebhookSchema = {
  tags: ["Webhook Subscriptions"],
  body: z.object({
    url: z.string().url("Invalid URL format"),
    events: z.array(webhookEvents).min(1, "At least one event is required"),
  }),
};

export const updateWebhookSchema = {
  tags: ["Webhook Subscriptions"],
  params: webhookIdParams,
  body: z.object({
    url: z.string().url("Invalid URL format").optional(),
    events: z.array(webhookEvents).min(1).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  }),
};

export const getWebhookSchema = {
  tags: ["Webhook Subscriptions"],
  params: webhookIdParams,
};

export const listWebhooksSchema = {
  tags: ["Webhook Subscriptions"],
  querystring: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20).optional(),
  }),
};

export const deleteWebhookSchema = {
  tags: ["Webhook Subscriptions"],
  params: webhookIdParams,
};

export const testWebhookSchema = {
  tags: ["Webhook Subscriptions"],
  params: webhookIdParams,
};

export type CreateWebhookBody = z.infer<typeof createWebhookSchema.body>;
export type UpdateWebhookBody = z.infer<typeof updateWebhookSchema.body>;
export type UpdateWebhookParams = z.infer<typeof updateWebhookSchema.params>;
export type GetWebhookParams = z.infer<typeof getWebhookSchema.params>;
export type ListWebhooksQuery = z.infer<typeof listWebhooksSchema.querystring>;
export type DeleteWebhookParams = z.infer<typeof deleteWebhookSchema.params>;
export type TestWebhookParams = z.infer<typeof testWebhookSchema.params>;
