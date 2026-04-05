import mongoose from "mongoose";
import { Client } from "./client.model.js";
import type {
  CreateClientBody,
  UpdateClientBody,
  ListClientsQuery,
} from "./client.schema.js";

export class ClientService {
  static async create(orgId: string, input: CreateClientBody) {
    const client = await Client.create({
      orgId: new mongoose.Types.ObjectId(orgId),
      ...input,
    });

    return { data: client.toJSON(), status: 201 };
  }

  static async getById(orgId: string, clientId: string, includeDeleted = false) {
    const query: Record<string, unknown> = {
      _id: clientId,
      orgId,
    };

    if (!includeDeleted) {
      query["deletedAt"] = null;
    }

    const client = await Client.findOne(query);
    if (!client) {
      return { error: "Client not found", status: 404 };
    }

    return { data: client.toJSON(), status: 200 };
  }

  static async list(orgId: string, query: ListClientsQuery) {
    const limit = query.limit ?? 20;

    const filter: Record<string, unknown> = {
      orgId,
      deletedAt: null,
    };

    // Cursor-based pagination: get documents after the cursor ID
    if (query.cursor) {
      filter["_id"] = { $lt: new mongoose.Types.ObjectId(query.cursor) };
    }

    // Search by name or email (escape special regex chars to prevent ReDoS)
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter["$or"] = [{ name: regex }, { email: regex }];
    }

    const clients = await Client.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = clients.length > limit;
    const results = hasMore ? clients.slice(0, limit) : clients;
    const nextCursor = hasMore ? String(results[results.length - 1]!._id) : null;

    return {
      data: {
        clients: results,
        nextCursor,
        hasMore,
      },
      status: 200,
    };
  }

  static async update(orgId: string, clientId: string, input: UpdateClientBody) {
    const client = await Client.findOneAndUpdate(
      { _id: clientId, orgId, deletedAt: null },
      input,
      { new: true, runValidators: true },
    );

    if (!client) {
      return { error: "Client not found", status: 404 };
    }

    return { data: client.toJSON(), status: 200 };
  }

  static async softDelete(orgId: string, clientId: string) {
    const client = await Client.findOneAndUpdate(
      { _id: clientId, orgId, deletedAt: null },
      { deletedAt: new Date() },
      { new: true },
    );

    if (!client) {
      return { error: "Client not found", status: 404 };
    }

    return { data: { message: "Client deleted" }, status: 200 };
  }
}
