import { redis } from "../config/redis.config.js";
import { logger } from "../observability/logger.js";

const LOCK_TTL_SECONDS = 5;
const LOCK_POLL_MS = 50;
const LOCK_MAX_WAIT_MS = 3000;

/**
 * Cache-aside with stampede prevention.
 *
 * On cache miss, acquires a Redis lock so only one caller hits the DB.
 * Other callers poll until the value appears or the lock expires.
 */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // Check cache
  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  // Try to acquire lock for cache population
  const lockKey = `${key}:lock`;
  const acquired = await redis.setNx(lockKey, "1", LOCK_TTL_SECONDS);

  if (acquired) {
    // We hold the lock -- fetch from DB, populate cache
    try {
      const value = await fetcher();
      await redis.set(key, JSON.stringify(value), ttlSeconds);
      return value;
    } catch (err) {
      // Release lock on failure so another caller can retry
      await redis.del(lockKey);
      throw err;
    }
  }

  // Another caller is populating -- wait for the cache to fill
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    const value = await redis.get(key);
    if (value !== null) {
      return JSON.parse(value) as T;
    }
  }

  // Timed out waiting -- fall through to DB directly
  logger.warn({ key }, "Cache stampede lock timed out, falling through to DB");
  return fetcher();
}

/**
 * Invalidate a cache key.
 */
export async function invalidateCache(key: string): Promise<void> {
  await redis.del(key);
}

/**
 * Invalidate all cache keys matching a prefix using SCAN (non-blocking).
 */
export async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.raw.scan(
      cursor,
      "MATCH",
      `${prefix}*`,
      "COUNT",
      100,
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.raw.del(...keys);
    }
  } while (cursor !== "0");
}

// Cache key builders
export const CacheKeys = {
  orgSettings: (orgId: string) => `cache:org:${orgId}:settings`,
  clientList: (orgId: string, queryHash: string) => `cache:org:${orgId}:clients:${queryHash}`,
};

// TTLs in seconds
export const CacheTTL = {
  ORG_SETTINGS: 300, // 5 minutes
  CLIENT_LIST: 60,   // 1 minute
};
