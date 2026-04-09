import mongoose from "mongoose";
import { SpanStatusCode } from "@opentelemetry/api";
import { stripe } from "../config/stripe.config.js";
import { Payment } from "../modules/payment/payment.model.js";
import { Invoice } from "../modules/invoice/invoice.model.js";
import { enqueue, QueueName } from "../queues/registry.js";
import { logger } from "../observability/logger.js";
import { tracer } from "../observability/tracer.js";

function sanitizePayment(obj: Record<string, unknown>): Record<string, unknown> {
  const { stripePaymentIntentId, ...rest } = obj;
  return rest;
}

export class PaymentSaga {
  /**
   * Orchestrates the checkout session flow with compensating actions:
   *
   * Step 1: Create Payment record (status: pending)
   * Step 2: Create Stripe Checkout Session
   * Step 3: Link Stripe session to Payment record
   *
   * If any step fails, previous steps are compensated.
   */
  static async executeCheckout(orgId: string, invoiceId: string) {
    return tracer.startActiveSpan("payment.checkout", async (span) => {
      span.setAttributes({ "payment.org_id": orgId, "payment.invoice_id": invoiceId });

      try {
        return await this._executeCheckout(orgId, invoiceId, span);
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private static async _executeCheckout(orgId: string, invoiceId: string, parentSpan: import("@opentelemetry/api").Span) {
    // ── Validate invoice ──────────────────────────────────────────────
    const invoice = await Invoice.findOne({ _id: invoiceId, orgId });
    if (!invoice) {
      return { error: "Invoice not found", status: 404 };
    }

    if (invoice.status === "paid") {
      return { error: "Invoice is already paid", status: 400 };
    }

    if (invoice.status === "cancelled") {
      return { error: "Cannot pay a cancelled invoice", status: 400 };
    }

    if (invoice.status === "draft") {
      return { error: "Invoice must be sent before payment", status: 400 };
    }

    if (!stripe) {
      return { error: "Stripe is not configured", status: 500 };
    }

    const amountInCents = Math.round(invoice.total * 100);

    // ── Step 1: Create Payment record ─────────────────────────────────
    let payment;
    try {
      payment = await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgId),
        invoiceId: new mongoose.Types.ObjectId(invoiceId),
        amount: invoice.total,
        currency: invoice.currency,
        status: "pending",
      });
      parentSpan.addEvent("saga.step1.completed", { "payment.id": String(payment._id) });
    } catch (err) {
      parentSpan.addEvent("saga.step1.failed");
      logger.error({ err, orgId, invoiceId }, "Saga step 1 failed: cannot create payment record");
      return { error: "Payment processing failed", status: 500 };
    }

    // ── Step 2: Create Stripe Checkout Session ────────────────────────
    let session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: invoice.currency.toLowerCase(),
              unit_amount: amountInCents,
              product_data: {
                name: `Invoice ${invoice.invoiceNumber}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          orgId,
          invoiceId: invoice.id as string,
          invoiceNumber: invoice.invoiceNumber,
        },
        success_url: `${process.env["APP_URL"] ?? "http://localhost:3000"}/v1/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env["APP_URL"] ?? "http://localhost:3000"}/v1/payments/cancelled`,
      });
      parentSpan.addEvent("saga.step2.completed", { "stripe.session_id": session.id });
    } catch (err) {
      // Compensate step 1: mark payment as failed
      parentSpan.addEvent("saga.step2.failed", { "compensation": "marking payment as failed" });
      logger.error({ err, paymentId: String(payment._id) }, "Saga step 2 failed: Stripe session creation");
      await Payment.findByIdAndUpdate(payment._id, {
        status: "failed",
        failureReason: "Stripe session creation failed",
      });
      return { error: "Payment processing failed", status: 502 };
    }

    // ── Step 3: Link Stripe session to Payment ────────────────────────
    try {
      await Payment.findByIdAndUpdate(payment._id, {
        stripePaymentIntentId: session.payment_intent as string | undefined,
      });
      parentSpan.addEvent("saga.step3.completed");
    } catch (err) {
      // Stripe session exists but DB update failed -- queue reconciliation
      parentSpan.addEvent("saga.step3.failed", { "compensation": "queuing reconciliation job" });
      logger.error(
        { err, paymentId: String(payment._id), sessionId: session.id },
        "Saga step 3 failed: DB update after Stripe session created",
      );
      await enqueue(QueueName.PAYMENTS, "reconcile-payment", {
        type: "reconcile-payment",
        paymentId: String(payment._id),
        stripeSessionId: session.id,
      });
      // Still return success -- the payment URL works, reconciliation will link the session
    }

    parentSpan.setAttributes({
      "payment.id": String(payment._id),
      "payment.amount": invoice.total,
      "payment.currency": invoice.currency,
    });

    return {
      data: {
        payment: sanitizePayment(payment.toJSON() as unknown as Record<string, unknown>),
        paymentUrl: session.url,
      },
      status: 201,
    };
  }
}
