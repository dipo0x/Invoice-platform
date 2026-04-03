import type { FastifyRequest, FastifyReply } from "fastify";
import { Member } from "../modules/member/member.model.js";

export async function tenantContextMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const orgId = request.headers["x-org-id"];

  if (!orgId || typeof orgId !== "string") {
    reply.status(400).send({ error: "x-org-id header is required" });
    return;
  }

  const member = await Member.findOne({
    orgId,
    userId: request.user!.id,
  });

  if (!member) {
    reply.status(403).send({ error: "Access denied" });
    return;
  }

  request.tenantContext = {
    orgId: member.orgId.toString(),
    role: member.role,
  };
}
