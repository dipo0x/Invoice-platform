import mongoose from "mongoose";
import { config } from "./index.config.js";
import { logger } from "../observability/logger.js";

export class Database {
  private uri: string;

  constructor(uri: string) {
    this.uri = uri;
  }

  async connect(): Promise<void> {
    mongoose.connection.on("connected", () => {
      logger.info("MongoDB connected");
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
    });

    mongoose.connection.on("error", (err) => {
      logger.error({ err }, "MongoDB connection error");
    });

    await mongoose.connect(this.uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
    logger.info("MongoDB connection closed");
  }

  get isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  get readyState(): number {
    return mongoose.connection.readyState;
  }

  async ping(): Promise<boolean> {
    try {
      await mongoose.connection.db!.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
}

export const database = new Database(config.MONGODB_URI);
