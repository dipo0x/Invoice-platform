import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import {
  createWebhookSchema,
  getWebhookSchema,
  listWebhooksSchema,
  updateWebhookSchema,
  deleteWebhookSchema,
  testWebhookSchema,
} from "./webhook-subscription.schema.js";
import { WebhookSubscriptionController } from "./webhook-subscription.controller.js";

export async function webhookSubscriptionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/", { schema: createWebhookSchema }, WebhookSubscriptionController.create);
  app.get("/", { schema: listWebhooksSchema }, WebhookSubscriptionController.list);
  app.get("/:id", { schema: getWebhookSchema }, WebhookSubscriptionController.getById);
  app.patch("/:id", { schema: updateWebhookSchema }, WebhookSubscriptionController.update);
  app.delete("/:id", { schema: deleteWebhookSchema }, WebhookSubscriptionController.delete);
  app.post("/:id/test", { schema: testWebhookSchema }, WebhookSubscriptionController.test);
}
