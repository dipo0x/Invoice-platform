import Fastify from "fastify";
import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { fastifyLoggerConfig } from "./observability/logger.js";
import { healthPlugin } from "./plugins/health.plugin.js";
import { rateLimiterPlugin } from "./plugins/rateLimiter.plugin.js";
import { authRoutes } from "./modules/auth/auth.route.js";
import { organizationRoutes } from "./modules/organization/organization.route.js";
import { clientRoutes } from "./modules/client/client.route.js";
import { invoiceRoutes } from "./modules/invoice/invoice.route.js";
import { recurringInvoiceRoutes } from "./modules/recurring-invoice/recurring-invoice.route.js";
import { paymentRoutes } from "./modules/payment/payment.route.js";
import { stripeWebhookRoute } from "./modules/payment/stripe-webhook.route.js";
import { webhookSubscriptionRoutes } from "./modules/webhook-subscription/webhook-subscription.route.js";
import { bullBoardPlugin } from "./plugins/bullBoard.plugin.js";

export function buildApp() {
  const app = Fastify({
    ...fastifyLoggerConfig,
    genReqId: () => crypto.randomUUID(),
  });

  // Zod validation & serialization
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Global error handler
  app.setErrorHandler(
    (error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
      if (error.validation && error.validation.length > 0) {
        const message = error.validation
          .map((err) => err.message)
          .join(", ");
        return reply.status(400).send({ error: "Validation failed", message });
      }

      const statusCode = error.statusCode ?? 500;
      return reply.status(statusCode).send({ error: error.message });
    },
  );

  // Plugins
  app.register(healthPlugin);
  app.register(rateLimiterPlugin);

  // Routes
  app.register(authRoutes, { prefix: "/v1/auth" });
  app.register(organizationRoutes, { prefix: "/v1/organizations" });
  app.register(clientRoutes, { prefix: "/v1/clients" });
  app.register(invoiceRoutes, { prefix: "/v1/invoices" });
  app.register(recurringInvoiceRoutes, { prefix: "/v1/recurring-invoices" });
  app.register(paymentRoutes, { prefix: "/v1" });
  app.register(stripeWebhookRoute, { prefix: "/v1" });
  app.register(webhookSubscriptionRoutes, { prefix: "/v1/webhook-subscriptions" });

  // Queue dashboard
  app.register(bullBoardPlugin);

  // Root route
  app.get("/", async () => {
    return { name: "invoice-platform", version: "1.0.0" };
  });

  return app;
}
