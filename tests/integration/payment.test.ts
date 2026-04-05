import { describe, it, expect, beforeEach } from "vitest";
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
    payload: { email: "pay-owner@test.com", password: "password123", name: "Pay Owner" },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "pay-owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
    payload: { name: "Payment Org", slug: "payment-org" },
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
    payload: { name: "Pay Client", email: "payclient@example.com" },
  });
  return res.json()._id;
}

async function createInvoice() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: authHeaders(token, orgId),
    payload: {
      clientId,
      lineItems: [{ description: "Consulting", quantity: 10, unitPrice: 150 }],
      dueDate: "2026-06-01T00:00:00.000Z",
    },
  });
  return res.json()._id;
}

async function sendInvoice(invoiceId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/invoices/${invoiceId}/send`,
    headers: authHeaders(token, orgId),
  });
}

async function cancelInvoice(invoiceId: string) {
  return app.inject({
    method: "POST",
    url: `/v1/invoices/${invoiceId}/cancel`,
    headers: authHeaders(token, orgId),
  });
}

describe("Payment API", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClient();
  });

  describe("POST /v1/invoices/:invoiceId/pay", () => {
    it("should return 400 for a draft invoice", async () => {
      const invoiceId = await createInvoice();

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/pay`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Invoice must be sent before payment");
    });

    it("should return 400 for a cancelled invoice", async () => {
      const invoiceId = await createInvoice();
      await sendInvoice(invoiceId);
      await cancelInvoice(invoiceId);

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/pay`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Cannot pay a cancelled invoice");
    });

    it("should return 404 for a non-existent invoice", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/invoices/665000000000000000000000/pay",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Invoice not found");
    });
  });

  describe("GET /v1/invoices/:invoiceId/payments", () => {
    it("should return an empty array when no payments exist", async () => {
      const invoiceId = await createInvoice();

      const res = await app.inject({
        method: "GET",
        url: `/v1/invoices/${invoiceId}/payments`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("should return 404 for a non-existent invoice", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/invoices/665000000000000000000000/payments",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Invoice not found");
    });
  });

  describe("POST /v1/payments/:paymentId/refund", () => {
    it("should return 404 for a non-existent payment", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/payments/665000000000000000000000/refund",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Payment not found");
    });
  });

  describe("POST /v1/payments/:paymentId/partial-refund", () => {
    it("should return 404 for a non-existent payment", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/payments/665000000000000000000000/partial-refund",
        headers: authHeaders(token, orgId),
        payload: { amount: 50 },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Payment not found");
    });

    it("should return 400 for invalid refund amount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/payments/665000000000000000000000/partial-refund",
        headers: authHeaders(token, orgId),
        payload: { amount: -10 },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
