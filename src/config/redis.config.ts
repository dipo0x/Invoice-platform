import { Redis } from "ioredis";
import { config } from "./index.config.js";
import { logger } from "../observability/logger.js";

export class RedisClient {
  private client: Redis;

  constructor(url: string, options: { maxRetriesPerRequest?: number | null } = {}) {
    this.client = new Redis(url, {
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 3,
      lazyConnect: true,
    });

    this.client.on("connect", () => {
      logger.info("Redis connected");
    });

    this.client.on("error", (err: Error) => {
      logger.error({ err }, "Redis connection error");
    });

    this.client.on("close", () => {
      logger.warn("Redis connection closed");
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    logger.info("Redis connection closed");
  }

  get status(): string {
    return this.client.status;
  }

  get isReady(): boolean {
    return this.client.status === "ready";
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /** Expose the raw ioredis instance for libraries that need it (e.g. @fastify/rate-limit) */
  get raw(): Redis {
    return this.client;
  }
}

export const redis = new RedisClient(config.REDIS_URL);
