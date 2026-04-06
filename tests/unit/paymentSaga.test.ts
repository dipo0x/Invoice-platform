import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
let orgId: string;
let clientId: string;

async function setupAuthAndOrg(appInstance: FastifyInstance) {
  await appInstance.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "saga-owner@test.com", password: "password123", name: "Saga Owner" },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "saga-owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
    payload: { name: "Saga Org", slug: "saga-org" },
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
    payload: { name: "Saga Client", email: "sagaclient@example.com" },
  });
  return res.json()._id;
}

async function createSentInvoice() {
  const createRes = await app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: authHeaders(token, orgId),
    payload: {
      clientId,
      lineItems: [{ description: "Saga Service", quantity: 2, unitPrice: 500 }],
      dueDate: "2026-08-01T00:00:00.000Z",
    },
  });
  const invoiceId = createRes.json()._id;

  await app.inject({
    method: "POST",
    url: `/v1/invoices/${invoiceId}/send`,
    headers: authHeaders(token, orgId),
  });

  return invoiceId;
}

describe("PaymentSaga", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClient();
  });

  it("should validate invoice before attempting checkout", async () => {
    const { PaymentSaga } = await import("../../src/lib/paymentSaga.js");

    // Non-existent invoice
    const result = await PaymentSaga.executeCheckout(orgId, "665000000000000000000000");
    expect(result.error).toBe("Invoice not found");
    expect(result.status).toBe(404);
  });

  it("should reject draft invoices", async () => {
    const { PaymentSaga } = await import("../../src/lib/paymentSaga.js");

    // Create an invoice but don't send it (stays as draft)
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: authHeaders(token, orgId),
      payload: {
        clientId,
        lineItems: [{ description: "Draft", quantity: 1, unitPrice: 100 }],
        dueDate: "2026-08-01T00:00:00.000Z",
      },
    });
    const invoiceId = createRes.json()._id;

    const result = await PaymentSaga.executeCheckout(orgId, invoiceId);
    expect(result.error).toBe("Invoice must be sent before payment");
    expect(result.status).toBe(400);
  });

  it("should create payment record before Stripe call (step ordering)", async () => {
    const invoiceId = await createSentInvoice();
    const { PaymentSaga } = await import("../../src/lib/paymentSaga.js");
    const { Payment } = await import("../../src/modules/payment/payment.model.js");

    // Mock Stripe to succeed
    const stripeConfig = await import("../../src/config/stripe.config.js");
    const originalStripe = stripeConfig.stripe;

    // Replace stripe with a mock that records the call order
    const callOrder: string[] = [];
    const mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockImplementation(async () => {
            // At this point, the payment record should already exist
            const payments = await Payment.find({ invoiceId, orgId }).lean();
            callOrder.push(`stripe_called_with_${payments.length}_payments`);
            return {
              id: "cs_test_saga",
              payment_intent: "pi_test_saga",
              url: "https://checkout.stripe.com/pay/cs_test_saga",
            };
          }),
        },
      },
    };

    // Use Object.defineProperty to replace the export
    Object.defineProperty(stripeConfig, "stripe", { value: mockStripe, writable: true });

    const result = await PaymentSaga.executeCheckout(orgId, invoiceId);

    // Restore
    Object.defineProperty(stripeConfig, "stripe", { value: originalStripe, writable: true });

    expect(result.status).toBe(201);
    // Payment record existed when Stripe was called
    expect(callOrder).toEqual(["stripe_called_with_1_payments"]);
  });

  it("should compensate step 1 when Stripe fails (step 2 failure)", async () => {
    const invoiceId = await createSentInvoice();
    const { PaymentSaga } = await import("../../src/lib/paymentSaga.js");
    const { Payment } = await import("../../src/modules/payment/payment.model.js");

    // Mock Stripe to fail
    const stripeConfig = await import("../../src/config/stripe.config.js");
    const originalStripe = stripeConfig.stripe;

    const mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockRejectedValue(new Error("Stripe API error")),
        },
      },
    };
    Object.defineProperty(stripeConfig, "stripe", { value: mockStripe, writable: true });

    const result = await PaymentSaga.executeCheckout(orgId, invoiceId);

    // Restore
    Object.defineProperty(stripeConfig, "stripe", { value: originalStripe, writable: true });

    // Should return 502 (upstream failure)
    expect(result.status).toBe(502);
    expect(result.error).toBe("Payment processing failed");

    // Payment record should be marked as failed (compensation)
    const payments = await Payment.find({ invoiceId, orgId }).lean();
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("failed");
  });
});
