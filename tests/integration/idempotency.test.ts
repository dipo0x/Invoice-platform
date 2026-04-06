import { describe, it, expect, beforeEach, vi } from "vitest";
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
    payload: { email: "idem-owner@test.com", password: "password123", name: "Idem Owner" },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "idem-owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
    payload: { name: "Idem Org", slug: "idem-org" },
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
    payload: { name: "Idem Client", email: "idemclient@example.com" },
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
      lineItems: [{ description: "Service", quantity: 1, unitPrice: 100 }],
      dueDate: "2026-07-01T00:00:00.000Z",
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

describe("Idempotency Middleware", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClient();
  });

  it("should process normally when Idempotency-Key header is missing", async () => {
    // Without the header, the request should proceed without idempotency protection
    const res = await app.inject({
      method: "POST",
      url: "/v1/invoices/665000000000000000000000/pay",
      headers: authHeaders(token, orgId),
    });

    // Gets a normal 404 for non-existent invoice, not blocked by idempotency
    expect(res.statusCode).toBe(404);
  });

  it("should process the first request and return cached response on second", async () => {
    const invoiceId = await createSentInvoice();
    const key = "test-key-unique-001";

    // Mock Stripe so the checkout session creation works
    const paymentServiceModule = await import("../../src/modules/payment/payment.service.js");
    const spy = vi.spyOn(paymentServiceModule.PaymentService, "createCheckoutSession");
    spy.mockImplementation(async (orgIdArg, invoiceIdArg) => {
      const mongoose = (await import("mongoose")).default;
      const { Invoice } = await import("../../src/modules/invoice/invoice.model.js");
      const { Payment } = await import("../../src/modules/payment/payment.model.js");

      const invoice = await Invoice.findOne({ _id: invoiceIdArg, orgId: orgIdArg });
      if (!invoice) return { error: "Invoice not found", status: 404 };
      if (invoice.status === "draft") return { error: "Invoice must be sent before payment", status: 400 };

      const payment = await Payment.create({
        orgId: new mongoose.Types.ObjectId(orgIdArg),
        invoiceId: new mongoose.Types.ObjectId(invoiceIdArg),
        stripePaymentIntentId: "pi_test_idem",
        amount: invoice.total,
        currency: invoice.currency,
        status: "pending",
      });

      const { stripePaymentIntentId, ...sanitized } = payment.toJSON() as Record<string, unknown>;
      return {
        data: { payment: sanitized, paymentUrl: "https://checkout.stripe.com/pay/cs_test_idem" },
        status: 201,
      };
    });

    // First request
    const res1 = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/pay`,
      headers: { ...authHeaders(token, orgId), "idempotency-key": key },
    });

    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();
    expect(body1.paymentUrl).toBeDefined();

    // Verify cache was stored in Redis
    const { redis } = await import("../../src/config/redis.config.js");
    const cached = await redis.get(`idempotency:${key}`);
    expect(cached).not.toBeNull();
    const parsed = JSON.parse(cached!);
    expect(parsed.inProgress).toBe(false);
    expect(parsed.statusCode).toBe(201);

    // Record spy call count before second request
    const callsBefore = spy.mock.calls.length;

    // Second request with same key -- should return cached response
    const res2 = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/pay`,
      headers: { ...authHeaders(token, orgId), "idempotency-key": key },
    });

    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual(body1);

    // Service should NOT have been called again
    expect(spy.mock.calls.length).toBe(callsBefore);

    spy.mockRestore();
  });

  it("should process independently with different idempotency keys", async () => {
    const invoiceId = await createSentInvoice();

    // Both requests should get 400 (draft validation or similar) -- the point is both are processed
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/invoices/665000000000000000000000/pay",
      headers: { ...authHeaders(token, orgId), "idempotency-key": "key-a" },
    });

    const res2 = await app.inject({
      method: "POST",
      url: "/v1/invoices/665000000000000000000000/pay",
      headers: { ...authHeaders(token, orgId), "idempotency-key": "key-b" },
    });

    // Both processed independently (both 404 for non-existent invoice)
    expect(res1.statusCode).toBe(404);
    expect(res2.statusCode).toBe(404);
  });

  it("should not require Idempotency-Key on GET requests", async () => {
    const invoiceId = await createSentInvoice();

    const res = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoiceId}/payments`,
      headers: authHeaders(token, orgId),
    });

    expect(res.statusCode).toBe(200);
  });
});
