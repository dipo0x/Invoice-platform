import type { FastifyRequest, FastifyReply } from "fastify";
import { TokenService } from "../lib/token.service.js";

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = TokenService.verifyAccessToken(token);
    request.user = { id: payload.id, email: payload.email };
  } catch {
    reply.status(401).send({ error: "Invalid or expired token" });
  }
}
