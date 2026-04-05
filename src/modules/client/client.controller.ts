import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreateClientBody,
  UpdateClientBody,
  UpdateClientParams,
  GetClientParams,
  GetClientQuery,
  ListClientsQuery,
  DeleteClientParams,
} from "./client.schema.js";
import { ClientService } from "./client.service.js";

export class ClientController {
  static async create(
    request: TypedRequest<CreateClientBody>,
    reply: FastifyReply,
  ) {
    const result = await ClientService.create(
      request.tenantContext!.orgId,
      request.body,
    );

    return reply.status(result.status).send(result.data);
  }

  static async getById(
    request: TypedRequest<unknown, GetClientQuery, GetClientParams>,
    reply: FastifyReply,
  ) {
    const includeDeleted = request.query.includeDeleted === "true";
    const result = await ClientService.getById(
      request.tenantContext!.orgId,
      request.params.id,
      includeDeleted,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async list(
    request: TypedRequest<unknown, ListClientsQuery>,
    reply: FastifyReply,
  ) {
    const result = await ClientService.list(
      request.tenantContext!.orgId,
      request.query,
    );

    return reply.status(result.status).send(result.data);
  }

  static async update(
    request: TypedRequest<UpdateClientBody, unknown, UpdateClientParams>,
    reply: FastifyReply,
  ) {
    const result = await ClientService.update(
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
    request: TypedRequest<unknown, unknown, DeleteClientParams>,
    reply: FastifyReply,
  ) {
    const result = await ClientService.softDelete(
      request.tenantContext!.orgId,
      request.params.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
