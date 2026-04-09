import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import { revenueReportSchema, invoiceReportSchema } from "./analytics.schema.js";
import { AnalyticsController } from "./analytics.controller.js";

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get("/revenue", { schema: revenueReportSchema }, AnalyticsController.revenue);
  app.get("/invoices", { schema: invoiceReportSchema }, AnalyticsController.invoices);
}
