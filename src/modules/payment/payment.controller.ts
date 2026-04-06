import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type {
  CreatePaymentIntentParams,
  ListPaymentsParams,
  RefundPaymentParams,
  PartialRefundParams,
  PartialRefundBody,
} from "./payment.schema.js";
import { PaymentService } from "./payment.service.js";
import { logger } from "../../observability/logger.js";

export class PaymentController {
  static async createCheckoutSession(
    request: TypedRequest<unknown, unknown, CreatePaymentIntentParams>,
    reply: FastifyReply,
  ) {
    try {
      const result = await PaymentService.createCheckoutSession(
        request.tenantContext!.orgId,
        request.params.invoiceId,
      );
      if (result.error) {
        return reply.status(result.status).send({ error: result.error });
      }
      return reply.status(result.status).send(result.data);
    } catch (err) {
      logger.error({ err }, "Failed to create checkout session");
      return reply.status(500).send({ error: "Payment processing failed" });
    }
  }

  static async listByInvoice(
    request: TypedRequest<unknown, unknown, ListPaymentsParams>,
    reply: FastifyReply,
  ) {
    const result = await PaymentService.listByInvoice(
      request.tenantContext!.orgId,
      request.params.invoiceId,
    );
    if (result.error) {
      return reply.status(result.status).send({ error: result.error });
    }

    return reply.status(result.status).send(result.data);
  }

  static async refund(
    request: TypedRequest<unknown, unknown, RefundPaymentParams>,
    reply: FastifyReply,
  ) {
    try {
      const result = await PaymentService.refund(
        request.tenantContext!.orgId,
        request.params.paymentId,
      );
      if (result.error) {
        return reply.status(result.status).send({ error: result.error });
      }
      return reply.status(result.status).send(result.data);
    } catch (err) {
      logger.error({ err }, "Failed to process refund");
      return reply.status(500).send({ error: "Refund processing failed" });
    }
  }

  static async partialRefund(
    request: TypedRequest<PartialRefundBody, unknown, PartialRefundParams>,
    reply: FastifyReply,
  ) {
    try {
      const result = await PaymentService.partialRefund(
        request.tenantContext!.orgId,
        request.params.paymentId,
        request.body.amount,
      );
      if (result.error) {
        return reply.status(result.status).send({ error: result.error });
      }
      return reply.status(result.status).send(result.data);
    } catch (err) {
      logger.error({ err }, "Failed to process partial refund");
      return reply.status(500).send({ error: "Refund processing failed" });
    }
  }
}
