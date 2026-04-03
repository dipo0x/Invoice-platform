import { Redis } from "ioredis";
import { config } from "./index.config.js";
import { logger } from "../observability/logger.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

redis.on("error", (err: Error) => {
  logger.error({ err }, "Redis connection error");
});

redis.on("close", () => {
  logger.warn("Redis connection closed");
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  logger.info("Redis connection closed");
}

export function getRedisStatus(): {
  status: "ready" | "not_ready";
} {
  return {
    status: redis.status === "ready" ? "ready" : "not_ready",
  };
}
