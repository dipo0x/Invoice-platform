import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreateOrgBody,
  GetOrgParams,
  UpdateOrgBody,
  UpdateOrgParams,
  InviteMemberBody,
  InviteMemberParams,
} from "./organization.schema.js";
import { OrganizationService } from "./organization.service.js";

export class OrganizationController {
  static async create(
    request: TypedRequest<CreateOrgBody>,
    reply: FastifyReply,
  ) {
    const result = await OrganizationService.create(
      request.body,
      request.user!.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async getById(
    request: TypedRequest<unknown, unknown, GetOrgParams>,
    reply: FastifyReply,
  ) {
    const result = await OrganizationService.getById(
      request.params.id,
      request.user!.id,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async update(
    request: TypedRequest<UpdateOrgBody, unknown, UpdateOrgParams>,
    reply: FastifyReply,
  ) {
    const result = await OrganizationService.update(
      request.params.id,
      request.user!.id,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async invite(
    request: TypedRequest<InviteMemberBody, unknown, InviteMemberParams>,
    reply: FastifyReply,
  ) {
    const result = await OrganizationService.inviteMember(
      request.params.id,
      request.user!.id,
      request.body,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }
}
