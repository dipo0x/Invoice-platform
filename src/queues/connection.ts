import { RedisClient } from "../config/redis.config.js";
import { config } from "../config/index.config.js";

// BullMQ needs its own Redis connection -- it uses blocking commands
// that would block cache reads if shared.
export const bullRedis = new RedisClient(config.REDIS_URL, {
  maxRetriesPerRequest: null,
});
