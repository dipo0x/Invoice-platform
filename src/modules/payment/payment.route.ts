import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { tenantContextMiddleware } from "../../middlewares/tenantContext.middleware.js";
import { auditLogMiddleware } from "../../middlewares/auditLog.middleware.js";
import {
  createPaymentIntentSchema,
  listPaymentsSchema,
  refundPaymentSchema,
  partialRefundSchema,
} from "./payment.schema.js";
import { PaymentController } from "./payment.controller.js";

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", authMiddleware);
  fastify.addHook("onRequest", tenantContextMiddleware);
  fastify.addHook("onRequest", auditLogMiddleware);

  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/invoices/:invoiceId/pay",
    { schema: createPaymentIntentSchema },
    PaymentController.createCheckoutSession,
  );
  app.get(
    "/invoices/:invoiceId/payments",
    { schema: listPaymentsSchema },
    PaymentController.listByInvoice,
  );
  app.post(
    "/payments/:paymentId/refund",
    { schema: refundPaymentSchema },
    PaymentController.refund,
  );
  app.post(
    "/payments/:paymentId/partial-refund",
    { schema: partialRefundSchema },
    PaymentController.partialRefund,
  );
}
