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

async function createClientForRecurring() {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: authHeaders(token, orgId),
    payload: { name: "Recurring Client", email: "recurring@example.com" },
  });
  return res.json()._id;
}

async function createRecurring(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/recurring-invoices",
    headers: authHeaders(token, orgId),
    payload: {
      clientId,
      lineItems: [
        { description: "Monthly Retainer", quantity: 1, unitPrice: 5000 },
      ],
      frequency: "monthly",
      startDate: "2026-06-01T00:00:00.000Z",
      ...overrides,
    },
  });
  return res;
}

describe("Recurring Invoice API", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
    clientId = await createClientForRecurring();
  });

  // ----------------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------------
  describe("POST /v1/recurring-invoices", () => {
    it("should create a recurring invoice with nextRunAt computed", async () => {
      const res = await createRecurring();

      expect(res.statusCode).toBe(201);
      const body = res.json();

      expect(body).toHaveProperty("_id");
      expect(body.status).toBe("active");
      expect(body.frequency).toBe("monthly");
      expect(body.nextRunAt).toBeTruthy();
      expect(body.lineItems).toHaveLength(1);
      expect(body.taxRate).toBe(0);
      expect(body.currency).toBe("USD");
    });

    it("should create a recurring invoice with all optional fields", async () => {
      const res = await createRecurring({
        taxRate: 15,
        currency: "EUR",
        endDate: "2027-06-01T00:00:00.000Z",
        notes: "Quarterly service",
        frequency: "quarterly",
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.taxRate).toBe(15);
      expect(body.currency).toBe("EUR");
      expect(body.frequency).toBe("quarterly");
      expect(body.endDate).toBeTruthy();
      expect(body.notes).toBe("Quarterly service");
    });

    it("should return 404 when client does not exist", async () => {
      const res = await createRecurring({ clientId: "665000000000000000000000" });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Client not found");
    });

    it("should return 400 with invalid frequency", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/recurring-invoices",
        headers: authHeaders(token, orgId),
        payload: {
          clientId,
          lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }],
          frequency: "daily",
          startDate: "2026-06-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 with empty lineItems", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/recurring-invoices",
        headers: authHeaders(token, orgId),
        payload: {
          clientId,
          lineItems: [],
          frequency: "monthly",
          startDate: "2026-06-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // LIST
  // ----------------------------------------------------------------
  describe("GET /v1/recurring-invoices", () => {
    it("should list recurring invoices", async () => {
      await createRecurring();
      await createRecurring();

      const res = await app.inject({
        method: "GET",
        url: "/v1/recurring-invoices",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recurringInvoices).toHaveLength(2);
      expect(body).toHaveProperty("hasMore");
      expect(body).toHaveProperty("nextCursor");
    });

    it("should filter by status", async () => {
      const activeRes = await createRecurring();
      await createRecurring();

      // Pause the first one
      const activeId = activeRes.json()._id;
      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${activeId}/pause`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "GET",
        url: "/v1/recurring-invoices?status=paused",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().recurringInvoices).toHaveLength(1);
      expect(res.json().recurringInvoices[0].status).toBe("paused");
    });
  });

  // ----------------------------------------------------------------
  // GET BY ID
  // ----------------------------------------------------------------
  describe("GET /v1/recurring-invoices/:id", () => {
    it("should return a recurring invoice by ID", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/recurring-invoices/${id}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()._id).toBe(id);
    });

    it("should return 404 for non-existent recurring invoice", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/recurring-invoices/665000000000000000000000",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------------
  describe("PATCH /v1/recurring-invoices/:id", () => {
    it("should update a recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/recurring-invoices/${id}`,
        headers: authHeaders(token, orgId),
        payload: {
          lineItems: [{ description: "Updated Retainer", quantity: 2, unitPrice: 3000 }],
          notes: "Updated",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().lineItems[0].description).toBe("Updated Retainer");
      expect(res.json().notes).toBe("Updated");
    });

    it("should return 400 when updating a cancelled recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/recurring-invoices/${id}`,
        headers: authHeaders(token, orgId),
        payload: { notes: "Should fail" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Cannot update a cancelled recurring invoice");
    });
  });

  // ----------------------------------------------------------------
  // PAUSE
  // ----------------------------------------------------------------
  describe("POST /v1/recurring-invoices/:id/pause", () => {
    it("should pause an active recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("paused");
    });

    it("should return 400 when pausing a paused recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only active recurring invoices can be paused");
    });

    it("should return 400 when pausing a cancelled recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only active recurring invoices can be paused");
    });
  });

  // ----------------------------------------------------------------
  // RESUME
  // ----------------------------------------------------------------
  describe("POST /v1/recurring-invoices/:id/resume", () => {
    it("should resume a paused recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/resume`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("active");
      expect(res.json().nextRunAt).toBeTruthy();
    });

    it("should return 400 when resuming an active recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/resume`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only paused recurring invoices can be resumed");
    });

    it("should return 400 when resuming a cancelled recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/resume`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Only paused recurring invoices can be resumed");
    });
  });

  // ----------------------------------------------------------------
  // CANCEL
  // ----------------------------------------------------------------
  describe("POST /v1/recurring-invoices/:id/cancel", () => {
    it("should cancel an active recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
      expect(res.json().nextRunAt).toBeNull();
    });

    it("should cancel a paused recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/pause`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
    });

    it("should return 400 when cancelling an already-cancelled recurring invoice", async () => {
      const createRes = await createRecurring();
      const id = createRes.json()._id;

      await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/recurring-invoices/${id}/cancel`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Recurring invoice is already cancelled");
    });
  });
});
