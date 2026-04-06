import type { FastifyInstance } from "fastify";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import { getQueue, QueueName } from "../queues/registry.js";

// ─── Bull Board Dashboard ───────────────────────────────────────────────────
//
// Mounts a web UI at /admin/queues that shows all 4 queues, their jobs
// (waiting, active, completed, failed, delayed), and lets you retry/remove
// jobs manually.
//
// In production, you'd protect this route with auth middleware so only
// admins can access it. For now, it's open for development.
//
// To view it: start the server and go to http://localhost:3000/admin/queues

export async function bullBoardPlugin(fastify: FastifyInstance): Promise<void> {
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(getQueue(QueueName.NOTIFICATIONS)),
      new BullMQAdapter(getQueue(QueueName.INVOICES)),
      new BullMQAdapter(getQueue(QueueName.PAYMENTS)),
      new BullMQAdapter(getQueue(QueueName.INTEGRATIONS)),
    ],
    serverAdapter,
  });

  await fastify.register(serverAdapter.registerPlugin(), {
    prefix: "/admin/queues",
  });
}
