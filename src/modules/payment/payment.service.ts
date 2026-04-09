import { stripe } from "../../config/stripe.config.js";
import { Payment } from "./payment.model.js";
import { Invoice } from "../invoice/invoice.model.js";
import { Client } from "../client/client.model.js";
import { enqueue, QueueName } from "../../queues/registry.js";
import { dispatchWebhooks } from "../../queues/jobs/dispatchWebhooks.js";
import { PaymentSaga } from "../../lib/paymentSaga.js";
import { paymentsProcessedTotal } from "../../observability/metrics.js";

function sanitizePayment(obj: Record<string, unknown>): Record<string, unknown> {
  const { stripePaymentIntentId, ...rest } = obj;
  return rest;
}

export class PaymentService {
  static async createCheckoutSession(orgId: string, invoiceId: string) {
    return PaymentSaga.executeCheckout(orgId, invoiceId);
  }

  static async listByInvoice(orgId: string, invoiceId: string) {
    const invoice = await Invoice.findOne({ _id: invoiceId, orgId });
    if (!invoice) {
      return { error: "Invoice not found", status: 404 };
    }

    const payments = await Payment.find({ invoiceId, orgId })
      .sort({ createdAt: -1 })
      .lean();

    const sanitized = payments.map((p) => sanitizePayment(p as unknown as Record<string, unknown>));

    return { data: sanitized, status: 200 };
  }

  static async refund(orgId: string, paymentId: string) {
    const payment = await Payment.findOne({ _id: paymentId, orgId });
    if (!payment) {
      return { error: "Payment not found", status: 404 };
    }

    if (payment.status !== "succeeded") {
      return { error: "Only succeeded payments can be refunded", status: 400 };
    }

    if (!payment.stripePaymentIntentId) {
      return { error: "No Stripe payment intent associated", status: 400 };
    }

    if (!stripe) {
      return { error: "Stripe is not configured", status: 500 };
    }

    await stripe.refunds.create({
      payment_intent: payment.stripePaymentIntentId,
    });

    const updated = await Payment.findByIdAndUpdate(
      paymentId,
      { status: "refunded" },
      { new: true },
    );

    // Update invoice status back
    await Invoice.findByIdAndUpdate(payment.invoiceId, { status: "sent" });

    return { data: sanitizePayment(updated!.toJSON() as unknown as Record<string, unknown>), status: 200 };
  }

  /** Partial refund support */
  static async partialRefund(orgId: string, paymentId: string, amount: number) {
    const payment = await Payment.findOne({ _id: paymentId, orgId });
    if (!payment) {
      return { error: "Payment not found", status: 404 };
    }

    if (payment.status !== "succeeded") {
      return { error: "Only succeeded payments can be refunded", status: 400 };
    }

    if (amount <= 0 || amount > payment.amount) {
      return { error: "Invalid refund amount", status: 400 };
    }

    if (!payment.stripePaymentIntentId) {
      return { error: "No Stripe payment intent associated", status: 400 };
    }

    if (!stripe) {
      return { error: "Stripe is not configured", status: 500 };
    }

    const amountInCents = Math.round(amount * 100);

    await stripe.refunds.create({
      payment_intent: payment.stripePaymentIntentId,
      amount: amountInCents,
    });

    const isFullRefund = amount >= payment.amount;
    const updated = await Payment.findByIdAndUpdate(
      paymentId,
      { status: isFullRefund ? "refunded" : "succeeded" },
      { new: true },
    );

    if (isFullRefund) {
      await Invoice.findByIdAndUpdate(payment.invoiceId, { status: "sent" });
    }

    return { data: sanitizePayment(updated!.toJSON() as unknown as Record<string, unknown>), status: 200 };
  }

  /** Called by Stripe webhook to update payment and invoice status. Idempotent -- safe to call multiple times. */
  static async handleWebhookEvent(event: { type: string; data: { object: unknown } }) {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          id: string;
          payment_intent: string;
          metadata: { orgId: string; invoiceId: string };
        };

        // Link the Stripe PaymentIntent to our Payment record and mark as succeeded
        const payment = await Payment.findOneAndUpdate(
          {
            orgId: session.metadata.orgId,
            invoiceId: session.metadata.invoiceId,
            status: { $ne: "succeeded" },
          },
          {
            stripePaymentIntentId: session.payment_intent,
            status: "succeeded",
            paidAt: new Date(),
          },
          { new: true },
        );

        if (payment) {
          await Invoice.findOneAndUpdate(
            { _id: payment.invoiceId, status: { $ne: "paid" } },
            { status: "paid", paidAt: new Date() },
          );
          paymentsProcessedTotal.inc({ org_id: session.metadata.orgId, status: "succeeded" });
          await this.enqueuePaymentNotifications(payment, session.metadata.orgId);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as { id: string };
        const payment = await Payment.findOne({
          stripePaymentIntentId: paymentIntent.id,
        });
        if (!payment) return;

        await Payment.findOneAndUpdate(
          { _id: payment._id, status: { $ne: "succeeded" } },
          { status: "succeeded", paidAt: new Date() },
        );
        await Invoice.findOneAndUpdate(
          { _id: payment.invoiceId, status: { $ne: "paid" } },
          { status: "paid", paidAt: new Date() },
        );
        await this.enqueuePaymentNotifications(payment, String(payment.orgId));
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as { id: string };
        const payment = await Payment.findOne({
          stripePaymentIntentId: paymentIntent.id,
        });
        if (!payment) return;

        await Payment.findOneAndUpdate(
          { _id: payment._id, status: { $ne: "failed" } },
          { status: "failed", failureReason: "Payment failed" },
        );

        paymentsProcessedTotal.inc({ org_id: String(payment.orgId), status: "failed" });
        await dispatchWebhooks(String(payment.orgId), "payment.failed", {
          paymentId: String(payment._id),
          invoiceId: String(payment.invoiceId),
        });
        break;
      }
    }
  }

  private static async enqueuePaymentNotifications(
    payment: { _id: unknown; invoiceId: unknown; amount: number; currency: string; orgId: unknown },
    orgId: string,
  ): Promise<void> {
    const invoice = await Invoice.findById(payment.invoiceId).lean();
    const client = invoice ? await Client.findById(invoice.clientId).lean() : null;

    if (client?.email && invoice) {
      await enqueue(QueueName.NOTIFICATIONS, "payment-receipt", {
        type: "send-payment-receipt",
        orgId,
        invoiceId: String(payment.invoiceId),
        paymentId: String(payment._id),
        recipientEmail: client.email,
        recipientName: client.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: payment.amount,
        currency: payment.currency,
      });
    }

    await dispatchWebhooks(orgId, "payment.succeeded", {
      paymentId: String(payment._id),
      invoiceId: String(payment.invoiceId),
      amount: payment.amount,
    });
  }
}
