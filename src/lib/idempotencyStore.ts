import { redis } from "../config/redis.config.js";

const KEY_PREFIX = "idempotency";
const TTL_SECONDS = 86_400; // 24 hours

interface CachedResponse {
  statusCode: number;
  body: string;
  inProgress: boolean;
}

export class IdempotencyStore {
  /**
   * Attempt to acquire a lock for the given idempotency key.
   * Returns true if the lock was acquired (key did not exist).
   */
  static async lock(key: string): Promise<boolean> {
    const value = JSON.stringify({ inProgress: true, statusCode: 0, body: "" });
    return redis.setNx(`${KEY_PREFIX}:${key}`, value, TTL_SECONDS);
  }

  /**
   * Retrieve a previously cached response.
   * Returns null if the key does not exist or the request is still in progress.
   */
  static async getResponse(key: string): Promise<CachedResponse | null> {
    const raw = await redis.get(`${KEY_PREFIX}:${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedResponse;
  }

  /**
   * Store the final response for a completed request.
   * Overwrites the in-progress marker with the actual response.
   */
  static async storeResponse(key: string, statusCode: number, body: string): Promise<void> {
    const value = JSON.stringify({ statusCode, body, inProgress: false });
    await redis.set(`${KEY_PREFIX}:${key}`, value, TTL_SECONDS);
  }

  /**
   * Remove the lock so the client can retry.
   * Called when the request results in a server error (5xx).
   */
  static async unlock(key: string): Promise<void> {
    await redis.del(`${KEY_PREFIX}:${key}`);
  }
}
