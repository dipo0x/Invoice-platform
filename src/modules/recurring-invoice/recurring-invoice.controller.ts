import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreateRecurringBody,
  UpdateRecurringBody,
  UpdateRecurringParams,
  GetRecurringParams,
  ListRecurringQuery,
  ActionRecurringParams,
} from "./recurring-invoice.schema.js";
import { RecurringInvoiceService } from "./recurring-invoice.service.js";

export class RecurringInvoiceController {
  static async create(
    request: TypedRequest<CreateRecurringBody>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.create(
      request.tenantContext!.orgId,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async getById(
    request: TypedRequest<unknown, unknown, GetRecurringParams>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.getById(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async list(
    request: TypedRequest<unknown, ListRecurringQuery>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.list(
      request.tenantContext!.orgId,
      request.query,
    );

    return reply.status(result.status).send(result.data);
  }

  static async update(
    request: TypedRequest<UpdateRecurringBody, unknown, UpdateRecurringParams>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.update(
      request.tenantContext!.orgId,
      request.params.id,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async pause(
    request: TypedRequest<unknown, unknown, ActionRecurringParams>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.pause(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async resume(
    request: TypedRequest<unknown, unknown, ActionRecurringParams>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.resume(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async cancel(
    request: TypedRequest<unknown, unknown, ActionRecurringParams>,
    reply: FastifyReply,
  ) {
    const result = await RecurringInvoiceService.cancel(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
