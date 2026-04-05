import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import {
  createRecurringSchema,
  getRecurringSchema,
  listRecurringSchema,
  updateRecurringSchema,
  pauseRecurringSchema,
  resumeRecurringSchema,
  cancelRecurringSchema,
} from "./recurring-invoice.schema.js";
import { RecurringInvoiceController } from "./recurring-invoice.controller.js";

export async function recurringInvoiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/", { schema: createRecurringSchema }, RecurringInvoiceController.create);
  app.get("/", { schema: listRecurringSchema }, RecurringInvoiceController.list);
  app.get("/:id", { schema: getRecurringSchema }, RecurringInvoiceController.getById);
  app.patch("/:id", { schema: updateRecurringSchema }, RecurringInvoiceController.update);
  app.post("/:id/pause", { schema: pauseRecurringSchema }, RecurringInvoiceController.pause);
  app.post("/:id/resume", { schema: resumeRecurringSchema }, RecurringInvoiceController.resume);
  app.post("/:id/cancel", { schema: cancelRecurringSchema }, RecurringInvoiceController.cancel);
}
