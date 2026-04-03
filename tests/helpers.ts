import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
  }
}
