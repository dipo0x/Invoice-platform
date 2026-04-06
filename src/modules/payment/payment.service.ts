import mongoose from "mongoose";
import { stripe } from "../../config/stripe.config.js";
import { Payment } from "./payment.model.js";
import { Invoice } from "../invoice/invoice.model.js";
import { Client } from "../client/client.model.js";
import { enqueue, QueueName } from "../../queues/registry.js";
import { dispatchWebhooks } from "../../queues/jobs/dispatchWebhooks.js";

function sanitizePayment(obj: Record<string, unknown>): Record<string, unknown> {
  const { stripePaymentIntentId, ...rest } = obj;
  return rest;
}

export class PaymentService {
  static async createCheckoutSession(orgId: string, invoiceId: string) {
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

    // Amount in cents for Stripe
    const amountInCents = Math.round(invoice.total * 100);

    const session = await stripe.checkout.sessions.create({
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

    const payment = await Payment.create({
      orgId: new mongoose.Types.ObjectId(orgId),
      invoiceId: new mongoose.Types.ObjectId(invoiceId),
      stripePaymentIntentId: session.payment_intent as string | undefined,
      amount: invoice.total,
      currency: invoice.currency,
      status: "pending",
    });

    return {
      data: {
        payment: sanitizePayment(payment.toJSON() as unknown as Record<string, unknown>),
        paymentUrl: session.url,
      },
      status: 201,
    };
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
