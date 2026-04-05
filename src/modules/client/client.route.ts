import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import {
  createClientSchema,
  getClientSchema,
  listClientsSchema,
  updateClientSchema,
  deleteClientSchema,
} from "./client.schema.js";
import { ClientController } from "./client.controller.js";

export async function clientRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/", { schema: createClientSchema }, ClientController.create);
  app.get("/", { schema: listClientsSchema }, ClientController.list);
  app.get("/:id", { schema: getClientSchema }, ClientController.getById);
  app.patch("/:id", { schema: updateClientSchema }, ClientController.update);
  app.delete("/:id", { schema: deleteClientSchema }, ClientController.delete);
}
