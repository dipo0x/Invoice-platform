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

/**
 * Read replica connection for analytics and reporting queries.
 * Uses secondaryPreferred read preference so reads go to secondaries when available,
 * falling back to primary when no secondaries exist (e.g. local dev).
 */
class ReadReplicaConnection {
  private connection: mongoose.Connection | null = null;

  async connect(): Promise<void> {
    const uri = config.MONGODB_READ_REPLICA_URI ?? config.MONGODB_URI;

    this.connection = mongoose.createConnection(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 60000,
      readPreference: "secondaryPreferred",
    });

    this.connection.on("connected", () => {
      logger.info("MongoDB read replica connected");
    });

    this.connection.on("error", (err) => {
      logger.error({ err }, "MongoDB read replica connection error");
    });

    await this.connection.asPromise();
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      logger.info("MongoDB read replica connection closed");
    }
  }

  getConnection(): mongoose.Connection {
    if (!this.connection) {
      throw new Error("Read replica connection not initialized. Call connect() first.");
    }
    return this.connection;
  }
}

export const database = new Database(config.MONGODB_URI);
export const readReplica = new ReadReplicaConnection();
