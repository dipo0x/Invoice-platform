import { Redis } from "ioredis";
import { config } from "../config/index.config.js";
import { logger } from "../observability/logger.js";

export const bullConnection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

bullConnection.on("connect", () => {
  logger.info("BullMQ Redis connected");
});

bullConnection.on("error", (err: Error) => {
  logger.error({ err }, "BullMQ Redis connection error");
});

export async function connectBullRedis(): Promise<void> {
  await bullConnection.connect();
}

export async function disconnectBullRedis(): Promise<void> {
  await bullConnection.quit();
  logger.info("BullMQ Redis connection closed");
}
