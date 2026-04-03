import { config } from "./config/index.config.js";
import { database } from "./config/database.config.js";
import { redis } from "./config/redis.config.js";
import { bullRedis } from "./queues/connection.js";
import { logger } from "./observability/logger.js";
import { buildApp } from "./app.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main(): Promise<void> {
  const app = buildApp();

  // Connect to external services
  await database.connect();
  await redis.connect();
  await bullRedis.connect();

  // Start HTTP server
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info(`Server listening on port ${config.PORT}`);

  // --- Graceful Shutdown ---
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(
      { signal },
      "Shutdown signal received, starting graceful shutdown",
    );

    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      logger.info("Closing HTTP server");
      await app.close();

      logger.info("Closing BullMQ Redis");
      await bullRedis.disconnect();

      logger.info("Closing Redis");
      await redis.disconnect();

      logger.info("Closing MongoDB");
      await database.disconnect();

      logger.info("Shutdown complete");
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      clearTimeout(forceExit);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});
