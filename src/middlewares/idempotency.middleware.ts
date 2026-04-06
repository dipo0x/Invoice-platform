import type { FastifyRequest, FastifyReply } from "fastify";
import { IdempotencyStore } from "../lib/idempotencyStore.js";
import { logger } from "../observability/logger.js";

/**
 * Custom error thrown when an idempotent response is available.
 * The global error handler does NOT see this -- the onSend hook intercepts it.
 */
export class IdempotentCachedError extends Error {
  statusCode: number;
  cachedBody: string;

  constructor(statusCode: number, body: string) {
    super("Idempotent cached response");
    this.statusCode = statusCode;
    this.cachedBody = body;
  }
}

/**
 * onRequest hook -- checks/acquires the idempotency lock.
 *
 * - GET/DELETE requests -> skip
 * - Missing header on POST/PATCH -> proceed without idempotency
 * - Key already processed -> throws IdempotentCachedError (caught by error handler)
 * - Key in progress (concurrent duplicate) -> throws IdempotentConflictError
 * - New key -> acquires lock, request proceeds normally
 */
export async function idempotencyOnRequest(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (request.method !== "POST" && request.method !== "PATCH") return;

  const key = request.headers["idempotency-key"] as string | undefined;
  if (!key) return; // header is optional; without it, no idempotency protection

  request.idempotencyKey = key;

  const acquired = await IdempotencyStore.lock(key);
  if (acquired) return; // lock acquired, proceed to handler

  // Key exists -- either in-progress or completed
  const cached = await IdempotencyStore.getResponse(key);

  if (!cached || cached.inProgress) {
    const err = new Error("A request with this idempotency key is already being processed");
    (err as Error & { statusCode: number }).statusCode = 409;
    throw err;
  }

  logger.info({ idempotencyKey: key }, "Returning cached idempotent response");
  throw new IdempotentCachedError(cached.statusCode, cached.body);
}

/**
 * onSend hook -- caches the response after the handler completes.
 *
 * On 5xx errors, the lock is removed so the client can retry with the same key.
 * On 4xx/2xx, the response is cached for 24 hours.
 */
export async function idempotencyOnSend(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
): Promise<unknown> {
  const key = request.idempotencyKey;
  if (!key) return payload;

  const statusCode = reply.statusCode;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);

  if (statusCode >= 500) {
    await IdempotencyStore.unlock(key);
  } else {
    await IdempotencyStore.storeResponse(key, statusCode, body);
  }

  return payload;
}
