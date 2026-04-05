import type { FastifyRequest, FastifyReply } from "fastify";
import type { MemberRole } from "../modules/member/member.model.js";

/**
 * Creates a route-level RBAC guard.
 * Usage: fastify.addHook("onRequest", requireRole("owner", "admin"))
 */
export function requireRole(...allowedRoles: MemberRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const role = request.tenantContext?.role;

    if (!role || !allowedRoles.includes(role)) {
      reply.status(403).send({
        error: `This action requires one of the following roles: ${allowedRoles.join(", ")}`,
      });
    }
  };
}
