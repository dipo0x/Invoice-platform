import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { redis } from "../config/redis.config.js";

interface DependencyStatus {
  status: "up" | "down";
  latencyMs: number;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  mongodb: DependencyStatus;
  redis: DependencyStatus;
  uptime: number;
}

async function checkMongo(): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    await mongoose.connection.db!.admin().ping();
    return { status: "up", latencyMs: Date.now() - start };
  } catch {
    return { status: "down", latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<DependencyStatus> {
  const start = Date.now();
  try {
    await redis.ping();
    return { status: "up", latencyMs: Date.now() - start };
  } catch {
    return { status: "down", latencyMs: Date.now() - start };
  }
}

function resolveOverallStatus(
  mongo: DependencyStatus,
  redisStatus: DependencyStatus,
): "healthy" | "degraded" | "unhealthy" {
  if (mongo.status === "up" && redisStatus.status === "up") return "healthy";
  if (mongo.status === "down" && redisStatus.status === "down")
    return "unhealthy";
  return "degraded";
}

export async function healthPlugin(fastify: FastifyInstance): Promise<void> {
  // Liveness — is the service functioning?
  fastify.get("/health", async (_request, reply) => {
    const [mongo, redisStatus] = await Promise.all([
      checkMongo(),
      checkRedis(),
    ]);

    const status = resolveOverallStatus(mongo, redisStatus);
    const statusCode = status === "unhealthy" ? 503 : 200;

    const response: HealthResponse = {
      status,
      mongodb: mongo,
      redis: redisStatus,
      uptime: process.uptime(),
    };

    return reply.status(statusCode).send(response);
  });

  // Readiness — can the service accept traffic right now?
  fastify.get("/ready", async (_request, reply) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = redis.status === "ready";

    if (mongoReady && redisReady) {
      return reply.status(200).send({ status: "ready" });
    }

    return reply.status(503).send({
      status: "not_ready",
      mongodb: mongoReady ? "ready" : "not_ready",
      redis: redisReady ? "ready" : "not_ready",
    });
  });
}
