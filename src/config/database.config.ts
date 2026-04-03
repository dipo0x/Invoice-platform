import mongoose from "mongoose";
import { config } from "./index.config.js";
import { logger } from "../observability/logger.js";

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB disconnected");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB connection error");
  });

  await mongoose.connect(config.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info("MongoDB connection closed");
}

export function getDatabaseStatus(): {
  status: "connected" | "disconnected";
  readyState: number;
} {
  const readyState = mongoose.connection.readyState;
  return {
    status: readyState === 1 ? "connected" : "disconnected",
    readyState,
  };
}
