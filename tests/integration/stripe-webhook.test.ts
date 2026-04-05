import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { getApp } from "../helpers.js";
import { PaymentService } from "../../src/modules/payment/payment.service.js";
import { Payment } from "../../src/modules/payment/payment.model.js";
import { Invoice } from "../../src/modules/invoice/invoice.model.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
let orgId: string;
let clientId: string;

async function setupAuthAndOrg(appInstance: FastifyInstance) {
  await appInstance.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "wh-owner@test.com", password: "password123", name: "WH Owner" },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "wh-owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
    payload: { name: "Webhook Org", slug: "webhook-org" },
  });
  const orgBody = orgRes.json();

  return { token: loginBody.accessToken, orgId: orgBody.organization._id };
}

function authHeaders(tkn: string, org: string) {
  return { authorization: `Bearer ${tkn}`, "x-org-id": org };
}

async function createClient() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: authHeaders(token, orgId),
    payload: { name: "WH Client", email: "whclient@example.com" },
  });
  return res.json()._id;
}

async function createAndSendInvoice() {
  const createRes = await app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: authHeaders(token, orgId),
    payload: {
      clientId,
      lineItems: [
        { description: "Webhook Service", quantity: 5, unitPrice: 200 },
      ],
      dueDate: "2026-07-01T00:00:00.000Z",
    },
  });
  const invoice = createRes.json();

  await app.inject({
    method: "POST",
    url: `/v1/invoices/${invoice._id}/send`,
    headers: authHeaders(token, orgId),
  });

  return invoice;
}

describe("Stripe Webhook", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClient();
  });

  // ----------------------------------------------------------------
  // POST /v1/webhooks/stripe -- route-level tests
  // ----------------------------------------------------------------
  describe("POST /v1/webhooks/stripe", () => {
    it("should return 500 when Stripe is not configured", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: {
          "content-type": "application/json",
          "stripe-signature": "t=123,v1=abc",
        },
        payload: JSON.stringify({ type: "payment_intent.succeeded" }),
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("Stripe is not configured");
    });

    it("should return 500 even without stripe-signature when Stripe is not configured", async () => {
      // The stripe-null check happens before the signature check
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "payment_intent.succeeded" }),
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe("Stripe is not configured");
    });
  });

  // ----------------------------------------------------------------
  // PaymentService.handleWebhookEvent -- unit tests
  // ----------------------------------------------------------------
  describe("PaymentService.handleWebhookEvent", () => {
    it("should mark payment as succeeded and invoice as paid on payment_intent.succeeded", async () => {
      const invoice = await createAndSendInvoice();

      // Manually create a payment record in the DB (simulating what Stripe flow would do)
      const payment = await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgId),
        invoiceId: new mongoose.Types.ObjectId(invoice._id),
        stripePaymentIntentId: "pi_test_success_001",
        amount: invoice.total,
        currency: "USD",
        status: "pending",
      });

      await PaymentService.handleWebhookEvent({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_test_success_001" } },
      });

      const updatedPayment = await Payment.findById(payment._id).lean();
      expect(updatedPayment!.status).toBe("succeeded");
      expect(updatedPayment!.paidAt).toBeTruthy();

      const updatedInvoice = await Invoice.findById(invoice._id).lean();
      expect(updatedInvoice!.status).toBe("paid");
      expect(updatedInvoice!.paidAt).toBeTruthy();
    });

    it("should be idempotent -- calling succeeded twice does not error", async () => {
      const invoice = await createAndSendInvoice();

      const payment = await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgId),
        invoiceId: new mongoose.Types.ObjectId(invoice._id),
        stripePaymentIntentId: "pi_test_idempotent_001",
        amount: invoice.total,
        currency: "USD",
        status: "pending",
      });

      const event = {
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_test_idempotent_001" } },
      };

      await PaymentService.handleWebhookEvent(event);
      await PaymentService.handleWebhookEvent(event);

      const updatedPayment = await Payment.findById(payment._id).lean();
      expect(updatedPayment!.status).toBe("succeeded");

      const updatedInvoice = await Invoice.findById(invoice._id).lean();
      expect(updatedInvoice!.status).toBe("paid");
    });

    it("should mark payment as failed on payment_intent.payment_failed", async () => {
      const invoice = await createAndSendInvoice();

      const payment = await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgId),
        invoiceId: new mongoose.Types.ObjectId(invoice._id),
        stripePaymentIntentId: "pi_test_fail_001",
        amount: invoice.total,
        currency: "USD",
        status: "pending",
      });

      await PaymentService.handleWebhookEvent({
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_test_fail_001" } },
      });

      const updatedPayment = await Payment.findById(payment._id).lean();
      expect(updatedPayment!.status).toBe("failed");
      expect(updatedPayment!.failureReason).toBe("Payment failed");
    });

    it("should silently ignore an unknown payment intent ID", async () => {
      // No payment exists for this ID -- should not throw
      await PaymentService.handleWebhookEvent({
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_nonexistent_999" } },
      });

      // If we reach here without throwing, the test passes
      expect(true).toBe(true);
    });

    it("should not change invoice status on payment_intent.payment_failed", async () => {
      const invoice = await createAndSendInvoice();

      await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgId),
        invoiceId: new mongoose.Types.ObjectId(invoice._id),
        stripePaymentIntentId: "pi_test_fail_invoice_001",
        amount: invoice.total,
        currency: "USD",
        status: "pending",
      });

      await PaymentService.handleWebhookEvent({
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_test_fail_invoice_001" } },
      });

      // Invoice should remain "sent", not change to "failed"
      const updatedInvoice = await Invoice.findById(invoice._id).lean();
      expect(updatedInvoice!.status).toBe("sent");
    });
  });
});
