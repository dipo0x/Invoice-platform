import { describe, it, expect, beforeAll } from "vitest";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

describe("Full flow: register -> login -> org -> client -> invoice -> payment", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getApp();
  });

  it("completes the entire flow from signup to payment", async () => {
    // ---- Step 1: Register ----
    const registerRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "founder@acme.com",
        password: "securepass123",
        name: "Acme Founder",
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const user = registerRes.json();
    expect(user.email).toBe("founder@acme.com");
    expect(user.name).toBe("Acme Founder");
    expect(user.password).toBeUndefined();

    // ---- Step 2: Duplicate register is rejected ----
    const dupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        email: "founder@acme.com",
        password: "securepass123",
        name: "Acme Founder",
      },
    });

    expect(dupRes.statusCode).toBe(409);

    // ---- Step 3: Login ----
    const loginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "founder@acme.com",
        password: "securepass123",
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json();
    expect(loginBody.accessToken).toBeDefined();
    expect(loginBody.refreshToken).toBeDefined();
    expect(loginBody.user.email).toBe("founder@acme.com");

    let accessToken = loginBody.accessToken;
    const refreshToken = loginBody.refreshToken;

    // ---- Step 4: Refresh token ----
    const refreshRes = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken },
    });

    expect(refreshRes.statusCode).toBe(200);
    const refreshBody = refreshRes.json();
    expect(refreshBody.accessToken).toBeDefined();
    expect(refreshBody.refreshToken).toBeDefined();
    accessToken = refreshBody.accessToken;

    // ---- Step 5: Reject unauthenticated request ----
    const noAuthRes = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      payload: { name: "Acme Corp", slug: "acme-corp" },
    });

    expect(noAuthRes.statusCode).toBe(401);

    // ---- Step 6: Create organization ----
    const orgRes = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: "Acme Corp", slug: "acme-corp" },
    });

    expect(orgRes.statusCode).toBe(201);
    const orgBody = orgRes.json();
    expect(orgBody.organization.name).toBe("Acme Corp");
    expect(orgBody.organization.slug).toBe("acme-corp");
    expect(orgBody.organization.plan).toBe("free");
    expect(orgBody.member.role).toBe("owner");

    const orgId = orgBody.organization._id;

    // ---- Step 7: Fetch org ----
    const getOrgRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${orgId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(getOrgRes.statusCode).toBe(200);
    expect(getOrgRes.json().name).toBe("Acme Corp");

    // ---- Step 8: Create client ----
    const clientRes = await app.inject({
      method: "POST",
      url: "/v1/clients",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
      payload: {
        name: "John Doe",
        email: "john@client.com",
        phone: "+1234567890",
        address: "123 Main St, Lagos",
      },
    });

    expect(clientRes.statusCode).toBe(201);
    const client = clientRes.json();
    expect(client.name).toBe("John Doe");
    expect(client.email).toBe("john@client.com");

    const clientId = client._id;

    // ---- Step 9: List clients ----
    const listClientsRes = await app.inject({
      method: "GET",
      url: "/v1/clients",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(listClientsRes.statusCode).toBe(200);
    expect(listClientsRes.json().clients).toHaveLength(1);

    // ---- Step 10: Create invoice ----
    const invoiceRes = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
      payload: {
        clientId,
        lineItems: [
          { description: "Web Development", quantity: 40, unitPrice: 100 },
          { description: "Design", quantity: 10, unitPrice: 80 },
        ],
        taxRate: 7.5,
        currency: "USD",
        dueDate: "2026-05-01T00:00:00.000Z",
        notes: "Payment due within 30 days",
      },
    });

    expect(invoiceRes.statusCode).toBe(201);
    const invoice = invoiceRes.json();
    expect(invoice.status).toBe("draft");
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(invoice.lineItems).toHaveLength(2);
    // 40*100 + 10*80 = 4800, tax = 4800 * 0.075 = 360, total = 5160
    expect(invoice.subtotal).toBe(4800);
    expect(invoice.taxAmount).toBe(360);
    expect(invoice.total).toBe(5160);

    const invoiceId = invoice._id;

    // ---- Step 11: Send invoice (draft -> sent) ----
    const sendRes = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/send`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(sendRes.statusCode).toBe(200);
    expect(sendRes.json().status).toBe("sent");

    // ---- Step 12: Reject payment on a draft invoice ----
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
      payload: {
        clientId,
        lineItems: [{ description: "Consulting", quantity: 1, unitPrice: 500 }],
        dueDate: "2026-06-01T00:00:00.000Z",
      },
    });

    const draftInvoiceId = draftRes.json()._id;

    const draftPayRes = await app.inject({
      method: "POST",
      url: `/v1/invoices/${draftInvoiceId}/pay`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(draftPayRes.statusCode).toBe(400);
    expect(draftPayRes.json().error).toBe("Invoice must be sent before payment");

    // ---- Step 13: Create Stripe payment intent ----
    const payRes = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/pay`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(payRes.statusCode).toBe(201);
    const payment = payRes.json();
    expect(payment.paymentUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(payment.payment.amount).toBe(5160);
    expect(payment.payment.currency).toBe("USD");
    expect(payment.payment.status).toBe("pending");

    // ---- Step 14: List payments ----
    const listPayRes = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoiceId}/payments`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(listPayRes.statusCode).toBe(200);
    expect(listPayRes.json()).toHaveLength(1);
    expect(listPayRes.json()[0].status).toBe("pending");

    // ---- Step 15: Simulate Stripe webhook (checkout.session.completed) ----
    const { PaymentService } = await import(
      "../../src/modules/payment/payment.service.js"
    );

    await PaymentService.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          payment_intent: "pi_test_from_checkout",
          metadata: { orgId, invoiceId },
        },
      },
    });

    // Verify payment is now succeeded
    const postWebhookPayRes = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoiceId}/payments`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(postWebhookPayRes.json()[0].status).toBe("succeeded");

    // Verify invoice is now paid
    const paidInvoiceRes = await app.inject({
      method: "GET",
      url: `/v1/invoices/${invoiceId}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    });

    expect(paidInvoiceRes.json().status).toBe("paid");
  });
});
