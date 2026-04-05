import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  UpdateInvoiceParams,
  GetInvoiceParams,
  ListInvoicesQuery,
  SendInvoiceParams,
  CancelInvoiceParams,
  MarkViewedParams,
} from "./invoice.schema.js";
import { InvoiceService } from "./invoice.service.js";

export class InvoiceController {
  static async create(
    request: TypedRequest<CreateInvoiceBody>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.create(
      request.tenantContext!.orgId,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async getById(
    request: TypedRequest<unknown, unknown, GetInvoiceParams>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.getById(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async list(
    request: TypedRequest<unknown, ListInvoicesQuery>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.list(
      request.tenantContext!.orgId,
      request.query,
    );

    return reply.status(result.status).send(result.data);
  }

  static async update(
    request: TypedRequest<UpdateInvoiceBody, unknown, UpdateInvoiceParams>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.update(
      request.tenantContext!.orgId,
      request.params.id,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async send(
    request: TypedRequest<unknown, unknown, SendInvoiceParams>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.send(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async cancel(
    request: TypedRequest<unknown, unknown, CancelInvoiceParams>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.cancel(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async markViewed(
    request: TypedRequest<unknown, unknown, MarkViewedParams>,
    reply: FastifyReply,
  ) {
    const result = await InvoiceService.markViewed(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
