import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  createOrgSchema,
  getOrgSchema,
  updateOrgSchema,
  inviteMemberSchema,
} from "./organization.schema.js";
import { OrganizationController } from "./organization.controller.js";

export async function organizationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post("/", { schema: createOrgSchema }, OrganizationController.create);
  app.get("/:id", { schema: getOrgSchema }, OrganizationController.getById);
  app.patch("/:id", { schema: updateOrgSchema }, OrganizationController.update);
  app.post("/:id/invite", { schema: inviteMemberSchema }, OrganizationController.invite);
}
