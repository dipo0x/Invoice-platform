import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { beforeAll, afterAll, afterEach } from "vitest";
import { closeApp } from "./helpers.js";

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env["MONGODB_URI"] = uri;
  process.env["REDIS_URL"] = "redis://localhost:6379";
  process.env["JWT_SECRET"] = "test-jwt-secret";
  process.env["JWT_REFRESH_SECRET"] = "test-jwt-refresh-secret";
  process.env["NODE_ENV"] = "test";

  await mongoose.connect(uri);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key]!.deleteMany({});
  }
});

afterAll(async () => {
  await closeApp();
  await mongoose.disconnect();
  await mongoServer.stop();
});
