import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type { RegisterBody, LoginBody, RefreshBody } from "./auth.schema.js";
import { AuthService } from "./auth.service.js";

export class AuthController {
  static async register(
    request: TypedRequest<RegisterBody>,
    reply: FastifyReply,
  ) {
    const result = await AuthService.register(request.body);
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async login(
    request: TypedRequest<LoginBody>,
    reply: FastifyReply,
  ) {
    const result = await AuthService.login(request.body);
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async refresh(
    request: TypedRequest<RefreshBody>,
    reply: FastifyReply,
  ) {
    const result = await AuthService.refresh(request.body.refreshToken);
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
