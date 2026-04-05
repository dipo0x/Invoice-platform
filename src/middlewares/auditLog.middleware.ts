import type { FastifyRequest, FastifyReply } from "fastify";
import { logger } from "../observability/logger.js";

/**
 * Logs mutations (POST, PATCH, DELETE) with user, org, and action context.
 * Attach to routes where audit trail matters (payments, invoices, org changes).
 */
export async function auditLogMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const method = request.method;

  // Only log mutations
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  reply.then(
    () => {
      logger.info({
        audit: true,
        userId: request.user?.id,
        orgId: request.tenantContext?.orgId,
        role: request.tenantContext?.role,
        method,
        url: request.url,
        statusCode: reply.statusCode,
      }, "Audit log");
    },
    () => {
      // Intentionally empty -- error logging handled elsewhere
    },
  );
}
