import mongoose from "mongoose";
import crypto from "node:crypto";
import { Client } from "./client.model.js";
import { cacheAside, invalidateCacheByPrefix, CacheKeys, CacheTTL } from "../../lib/cache.js";
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

    await invalidateCacheByPrefix(`cache:org:${orgId}:clients:`);

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

    // Build a stable hash of query params for the cache key
    const queryHash = crypto
      .createHash("md5")
      .update(JSON.stringify({ cursor: query.cursor, limit, search: query.search }))
      .digest("hex")
      .slice(0, 12);

    const result = await cacheAside(
      CacheKeys.clientList(orgId, queryHash),
      CacheTTL.CLIENT_LIST,
      async () => {
        const filter: Record<string, unknown> = {
          orgId,
          deletedAt: null,
        };

        if (query.cursor) {
          filter["_id"] = { $lt: new mongoose.Types.ObjectId(query.cursor) };
        }

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

        return { clients: results, nextCursor, hasMore };
      },
    );

    return { data: result, status: 200 };
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

    await invalidateCacheByPrefix(`cache:org:${orgId}:clients:`);

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

    await invalidateCacheByPrefix(`cache:org:${orgId}:clients:`);

    return { data: { message: "Client deleted" }, status: 200 };
  }
}
