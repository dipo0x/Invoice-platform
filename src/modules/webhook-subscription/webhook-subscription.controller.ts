import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreateWebhookBody,
  UpdateWebhookBody,
  UpdateWebhookParams,
  GetWebhookParams,
  ListWebhooksQuery,
  DeleteWebhookParams,
  TestWebhookParams,
} from "./webhook-subscription.schema.js";
import { WebhookSubscriptionService } from "./webhook-subscription.service.js";

export class WebhookSubscriptionController {
  static async create(
    request: TypedRequest<CreateWebhookBody>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.create(
      request.tenantContext!.orgId,
      request.body,
    );

    return reply.status(result.status).send(result.data);
  }

  static async getById(
    request: TypedRequest<unknown, unknown, GetWebhookParams>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.getById(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async list(
    request: TypedRequest<unknown, ListWebhooksQuery>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.list(
      request.tenantContext!.orgId,
      request.query,
    );

    return reply.status(result.status).send(result.data);
  }

  static async update(
    request: TypedRequest<UpdateWebhookBody, unknown, UpdateWebhookParams>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.update(
      request.tenantContext!.orgId,
      request.params.id,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async delete(
    request: TypedRequest<unknown, unknown, DeleteWebhookParams>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.delete(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async test(
    request: TypedRequest<unknown, unknown, TestWebhookParams>,
    reply: FastifyReply,
  ) {
    const result = await WebhookSubscriptionService.test(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
