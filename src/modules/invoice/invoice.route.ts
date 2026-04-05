import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import { auditLogMiddleware } from "../../middlewares/auditLog.middleware.js";
import {
  createInvoiceSchema,
  getInvoiceSchema,
  listInvoicesSchema,
  updateInvoiceSchema,
  sendInvoiceSchema,
  cancelInvoiceSchema,
  markViewedSchema,
} from "./invoice.schema.js";
import { InvoiceController } from "./invoice.controller.js";

export async function invoiceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);
  fastify.addHook("onRequest", auditLogMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/", { schema: createInvoiceSchema }, InvoiceController.create);
  app.get("/", { schema: listInvoicesSchema }, InvoiceController.list);
  app.get("/:id", { schema: getInvoiceSchema }, InvoiceController.getById);
  app.patch("/:id", { schema: updateInvoiceSchema }, InvoiceController.update);
  app.post("/:id/send", { schema: sendInvoiceSchema }, InvoiceController.send);
  app.post("/:id/cancel", { schema: cancelInvoiceSchema }, InvoiceController.cancel);
  app.post("/:id/viewed", { schema: markViewedSchema }, InvoiceController.markViewed);
}
