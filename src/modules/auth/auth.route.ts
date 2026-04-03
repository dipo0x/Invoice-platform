import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { registerSchema, loginSchema, refreshSchema } from "./auth.schema.js";
import { AuthController } from "./auth.controller.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/register", { schema: registerSchema }, AuthController.register);
  app.post("/login", { schema: loginSchema }, AuthController.login);
  app.post("/refresh", { schema: refreshSchema }, AuthController.refresh);
}
