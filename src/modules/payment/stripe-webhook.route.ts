import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { stripe } from "../../config/stripe.config.js";
import { config } from "../../config/index.config.js";
import { redis } from "../../config/redis.config.js";
import { PaymentService } from "./payment.service.js";
import { logger } from "../../observability/logger.js";

const STRIPE_EVENT_TTL = 172_800; // 48 hours

export async function stripeWebhookRoute(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    },
  );

  fastify.post(
    "/webhooks/stripe",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!stripe || !config.STRIPE_WEBHOOK_SECRET) {
        return reply.status(500).send({ error: "Stripe is not configured" });
      }

      const signature = request.headers["stripe-signature"];
      if (!signature) {
        return reply.status(400).send({ error: "Missing stripe-signature header" });
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          request.body as Buffer,
          signature as string,
          config.STRIPE_WEBHOOK_SECRET,
        );
      } catch (err) {
        logger.error({ err }, "Stripe webhook signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      logger.info({ type: event.type, id: event.id }, "Stripe webhook received");

      // Deduplicate: Stripe guarantees at-least-once delivery
      const dedupeKey = `stripe:event:${event.id}`;
      const isNew = await redis.setNx(dedupeKey, "1", STRIPE_EVENT_TTL);
      if (!isNew) {
        logger.info({ eventId: event.id }, "Duplicate Stripe event ignored");
        return reply.status(200).send({ received: true });
      }

      await PaymentService.handleWebhookEvent(event);

      return reply.status(200).send({ received: true });
    },
  );
}
