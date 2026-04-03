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

  // Root route
  app.get("/", async () => {
    return { name: "invoice-platform", version: "1.0.0" };
  });

  return app;
}
