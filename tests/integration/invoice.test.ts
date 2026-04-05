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
    payload: { email: "owner@test.com", password: "password123", name: "Owner" },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${loginBody.accessToken}` },
    payload: { name: "Test Org", slug: "test-org" },
  });
  const orgBody = orgRes.json();

  return { token: loginBody.accessToken, orgId: orgBody.organization._id };
}

function authHeaders(tkn: string, org: string) {
  return { authorization: `Bearer ${tkn}`, "x-org-id": org };
}

async function createClientForInvoice() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: authHeaders(token, orgId),
    payload: { name: "Invoice Client", email: "invoiceclient@example.com" },
  });
  return res.json()._id;
}

async function createInvoice(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: authHeaders(token, orgId),
    payload: {
      clientId,
      lineItems: [
        { description: "Web Development", quantity: 10, unitPrice: 150 },
      ],
      dueDate: "2026-05-01T00:00:00.000Z",
      ...overrides,
    },
  });
  return res;
}

describe("Invoice API", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClientForInvoice();
  });

  // ----------------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------------
  describe("POST /v1/invoices", () => {
    it("should create an invoice with auto-generated invoiceNumber and computed totals", async () => {
      const res = await createInvoice({
        lineItems: [
          { description: "Design", quantity: 5, unitPrice: 200 },
          { description: "Dev", quantity: 10, unitPrice: 100 },
        ],
        taxRate: 10,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();

      expect(body).toHaveProperty("_id");
      expect(body.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
      expect(body.status).toBe("draft");
      expect(body.currency).toBe("USD");

      // subtotal = (5*200) + (10*100) = 1000 + 1000 = 2000
      expect(body.subtotal).toBe(2000);
      // taxAmount = 2000 * 10/100 = 200
      expect(body.taxAmount).toBe(200);
      // total = 2000 + 200 = 2200
      expect(body.total).toBe(2200);

      expect(body.lineItems).toHaveLength(2);
      expect(body.lineItems[0].amount).toBe(1000);
      expect(body.lineItems[1].amount).toBe(1000);
    });

    it("should default taxRate to 0 and currency to USD", async () => {
      const res = await createInvoice();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.taxRate).toBe(0);
      expect(body.taxAmount).toBe(0);
      expect(body.currency).toBe("USD");
      // subtotal = 10 * 150 = 1500, total = 1500
      expect(body.subtotal).toBe(1500);
      expect(body.total).toBe(1500);
    });

    it("should return 404 when client does not exist", async () => {
      const res = await createInvoice({ clientId: "665000000000000000000000" });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Client not found");
    });

    it("should return 400 with empty lineItems array", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: authHeaders(token, orgId),
        payload: {
          clientId,
          lineItems: [],
          dueDate: "2026-05-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 with invalid dueDate format", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: authHeaders(token, orgId),
        payload: {
          clientId,
          lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }],
          dueDate: "not-a-date",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when lineItem has negative quantity", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: authHeaders(token, orgId),
        payload: {
          clientId,
          lineItems: [{ description: "Bad", quantity: -1, unitPrice: 100 }],
          dueDate: "2026-05-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should generate sequential invoice numbers", async () => {
      const res1 = await createInvoice();
      const res2 = await createInvoice();

      const num1 = res1.json().invoiceNumber;
      const num2 = res2.json().invoiceNumber;

      expect(num1).not.toBe(num2);
      // Both should follow INV-YYYY-NNNN pattern
      expect(num1).toMatch(/^INV-\d{4}-\d{4}$/);
      expect(num2).toMatch(/^INV-\d{4}-\d{4}$/);
    });
  });

  // ----------------------------------------------------------------
  // LIST
  // ----------------------------------------------------------------
  describe("GET /v1/invoices", () => {
    it("should list invoices", async () => {
      await createInvoice();
      await createInvoice();

      const res = await app.inject({
        method: "GET",
        url: "/v1/invoices",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.invoices).toHaveLength(2);
      expect(body).toHaveProperty("hasMore");
      expect(body).toHaveProperty("nextCursor");
    });

    it("should filter invoices by status", async () => {
      await createInvoice();
      const sentRes = await createInvoice();
      const sentId = sentRes.json()._id;

      // Send the second invoice
      await app.inject({
        method: "POST",
        url: `/v1/invoices/${sentId}/send`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/invoices?status=sent",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.invoices).toHaveLength(1);
      expect(body.invoices[0].status).toBe("sent");
    });

    it("should filter invoices by clientId", async () => {
      await createInvoice();

      // Create a second client with a different invoice
      const client2Res = await app.inject({
        method: "POST",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
        payload: { name: "Other Client", email: "other@example.com" },
      });
      const client2Id = client2Res.json()._id;

      await createInvoice({ clientId: client2Id });

      const res = await app.inject({
        method: "GET",
        url: `/v1/invoices?clientId=${client2Id}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().invoices).toHaveLength(1);
    });
  });

  // ----------------------------------------------------------------
  // GET BY ID
  // ----------------------------------------------------------------
  describe("GET /v1/invoices/:id", () => {
    it("should return an invoice by ID", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/invoices/${invoiceId}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()._id).toBe(invoiceId);
    });

    it("should return 404 for non-existent invoice", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/invoices/665000000000000000000000",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------------
  describe("PATCH /v1/invoices/:id", () => {
    it("should update a draft invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/invoices/${invoiceId}`,
        headers: authHeaders(token, orgId),
        payload: {
          lineItems: [{ description: "Updated Work", quantity: 20, unitPrice: 200 }],
          taxRate: 5,
          notes: "Updated notes",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.lineItems).toHaveLength(1);
      expect(body.lineItems[0].description).toBe("Updated Work");
      // subtotal = 20 * 200 = 4000
      expect(body.subtotal).toBe(4000);
      // taxAmount = 4000 * 5/100 = 200
      expect(body.taxAmount).toBe(200);
      // total = 4000 + 200 = 4200
      expect(body.total).toBe(4200);
      expect(body.notes).toBe("Updated notes");
    });

    it("should return 400 when updating a sent invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      // Send the invoice first
      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/invoices/${invoiceId}`,
        headers: authHeaders(token, orgId),
        payload: { notes: "This should fail" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only draft invoices can be updated");
    });

    it("should return 404 for non-existent invoice", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/invoices/665000000000000000000000",
        headers: authHeaders(token, orgId),
        payload: { notes: "test" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // SEND
  // ----------------------------------------------------------------
  describe("POST /v1/invoices/:id/send", () => {
    it("should send a draft invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("sent");
      expect(body.sentAt).toBeTruthy();
    });

    it("should return 400 when sending an already-sent invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot transition");
    });
  });

  // ----------------------------------------------------------------
  // CANCEL
  // ----------------------------------------------------------------
  describe("POST /v1/invoices/:id/cancel", () => {
    it("should cancel a draft invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
    });

    it("should cancel a sent invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
    });

    it("should return 400 when cancelling an already-cancelled invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // MARK VIEWED
  // ----------------------------------------------------------------
  describe("POST /v1/invoices/:id/viewed", () => {
    it("should mark a sent invoice as viewed", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/viewed`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("viewed");
      expect(body.viewedAt).toBeTruthy();
    });

    it("should return 400 when marking a draft as viewed", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/viewed`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot transition");
    });
  });

  // ----------------------------------------------------------------
  // INVALID STATE TRANSITIONS
  // ----------------------------------------------------------------
  describe("Invalid state transitions", () => {
    it("should return 400 when transitioning draft directly to paid", async () => {
      // There is no direct "pay" endpoint, but we can verify via the send/viewed transitions
      // draft -> viewed is invalid
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/viewed`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Cannot transition from "draft" to "viewed"');
    });

    it("should return 400 when trying to send a cancelled invoice", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/invoices/${invoiceId}/send`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Cannot transition from "cancelled" to "sent"');
    });
  });

  // ----------------------------------------------------------------
  // TENANT ISOLATION
  // ----------------------------------------------------------------
  describe("Tenant isolation", () => {
    it("should not allow org B to see org A invoices", async () => {
      const createRes = await createInvoice();
      const invoiceId = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: "other@test.com", password: "password123", name: "Other" },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "other@test.com", password: "password123" },
      });
      const otherToken = loginRes.json().accessToken;

      const orgRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { name: "Other Org", slug: "other-org" },
      });
      const otherOrgId = orgRes.json().organization._id;

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/invoices/${invoiceId}`,
        headers: authHeaders(otherToken, otherOrgId),
      });

      expect(getRes.statusCode).toBe(404);
    });
  });
});
