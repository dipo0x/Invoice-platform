import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { registerSchema, loginSchema, refreshSchema } from "./auth.schema.js";
import { AuthController } from "./auth.controller.js";
import { authRateLimitConfig } from "../../plugins/rateLimiter.plugin.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/register", { schema: registerSchema, ...authRateLimitConfig }, AuthController.register);
  app.post("/login", { schema: loginSchema, ...authRateLimitConfig }, AuthController.login);
  app.post("/refresh", { schema: refreshSchema }, AuthController.refresh);
}
