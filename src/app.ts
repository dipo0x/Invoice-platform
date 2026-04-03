import Fastify from "fastify";
import { fastifyLoggerConfig } from "./observability/logger.js";
import { healthPlugin } from "./plugins/health.plugin.js";

export function buildApp() {
  const app = Fastify({
    ...fastifyLoggerConfig,
    genReqId: () => crypto.randomUUID(),
  });

  app.register(healthPlugin);

  app.get("/", async () => {
    return { name: "invoice-platform", version: "1.0.0" };
  });

  return app;
}
