import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { redis } from "../config/redis.config.js";

export async function rateLimiterPlugin(
  fastify: FastifyInstance,
): Promise<void> {
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
    redis: redis.raw,
    keyGenerator: (request) => {
      if (request.tenantContext?.orgId) {
        return request.tenantContext.orgId;
      }
      return request.ip;
    },
    allowList: (request) => {
      return request.url === "/health" || request.url === "/ready";
    },
    errorResponseBuilder: (_request, context) => {
      return {
        error: "Too many requests",
        message: `Rate limit exceeded. Try again in ${context.after}`,
        statusCode: 429,
      };
    },
  });
}

export const authRateLimitConfig = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: "1 minute",
      keyGenerator: (request: { ip: string }) => request.ip,
    },
  },
};
