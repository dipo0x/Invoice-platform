import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
let orgId: string;

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

async function createWebhook(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/webhook-subscriptions",
    headers: authHeaders(token, orgId),
    payload: {
      url: "https://example.com/webhook",
      events: ["invoice.created", "invoice.paid"],
      ...overrides,
    },
  });
  return res;
}

describe("Webhook Subscription API", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
  });

  // ----------------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------------
  describe("POST /v1/webhook-subscriptions", () => {
    it("should create a webhook subscription with a generated secret", async () => {
      const res = await createWebhook();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("_id");
      expect(body.url).toBe("https://example.com/webhook");
      expect(body.events).toEqual(["invoice.created", "invoice.paid"]);
      expect(body.status).toBe("active");
      expect(body.secret).toBeTruthy();
      expect(body.secret).toMatch(/^whsec_/);
    });

    it("should return 400 for invalid URL", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
        payload: {
          url: "not-a-url",
          events: ["invoice.created"],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for empty events array", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
        payload: {
          url: "https://example.com/webhook",
          events: [],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for invalid event type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
        payload: {
          url: "https://example.com/webhook",
          events: ["invalid.event"],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when url is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
        payload: {
          events: ["invoice.created"],
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when events is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
        payload: {
          url: "https://example.com/webhook",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/webhook-subscriptions",
        payload: {
          url: "https://example.com/webhook",
          events: ["invoice.created"],
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  // LIST
  // ----------------------------------------------------------------
  describe("GET /v1/webhook-subscriptions", () => {
    it("should return empty list when no subscriptions exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.subscriptions).toHaveLength(0);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it("should list created subscriptions", async () => {
      await createWebhook();
      await createWebhook({ url: "https://other.com/hook", events: ["invoice.sent"] });

      const res = await app.inject({
        method: "GET",
        url: "/v1/webhook-subscriptions",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().subscriptions).toHaveLength(2);
    });

    it("should paginate with limit and cursor", async () => {
      await createWebhook({ url: "https://a.com/hook" });
      await createWebhook({ url: "https://b.com/hook" });
      await createWebhook({ url: "https://c.com/hook" });

      const firstPage = await app.inject({
        method: "GET",
        url: "/v1/webhook-subscriptions?limit=2",
        headers: authHeaders(token, orgId),
      });

      const page1 = firstPage.json();
      expect(page1.subscriptions).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const secondPage = await app.inject({
        method: "GET",
        url: `/v1/webhook-subscriptions?limit=2&cursor=${page1.nextCursor}`,
        headers: authHeaders(token, orgId),
      });

      const page2 = secondPage.json();
      expect(page2.subscriptions).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // GET BY ID
  // ----------------------------------------------------------------
  describe("GET /v1/webhook-subscriptions/:id", () => {
    it("should return a subscription by ID", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()._id).toBe(id);
    });

    it("should return 404 for non-existent subscription", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/webhook-subscriptions/665000000000000000000000",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------------
  describe("PATCH /v1/webhook-subscriptions/:id", () => {
    it("should update a subscription URL", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
        payload: { url: "https://updated.com/hook" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().url).toBe("https://updated.com/hook");
    });

    it("should update subscription events", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
        payload: { events: ["payment.succeeded", "payment.failed"] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().events).toEqual(["payment.succeeded", "payment.failed"]);
    });

    it("should update subscription status to inactive", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
        payload: { status: "inactive" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("inactive");
    });

    it("should return 404 when updating non-existent subscription", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/webhook-subscriptions/665000000000000000000000",
        headers: authHeaders(token, orgId),
        payload: { url: "https://nowhere.com/hook" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 400 for invalid URL on update", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
        payload: { url: "not-a-valid-url" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // DELETE
  // ----------------------------------------------------------------
  describe("DELETE /v1/webhook-subscriptions/:id", () => {
    it("should delete a subscription", async () => {
      const createRes = await createWebhook();
      const id = createRes.json()._id;

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().message).toBe("Webhook subscription deleted");

      // Verify it is gone
      const getRes = await app.inject({
        method: "GET",
        url: `/v1/webhook-subscriptions/${id}`,
        headers: authHeaders(token, orgId),
      });

      expect(getRes.statusCode).toBe(404);
    });

    it("should return 404 when deleting non-existent subscription", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/v1/webhook-subscriptions/665000000000000000000000",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // TENANT ISOLATION
  // ----------------------------------------------------------------
  describe("Tenant isolation", () => {
    it("should not allow org B to see org A webhook subscriptions", async () => {
      const createRes = await createWebhook();
      const webhookId = createRes.json()._id;

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
        url: `/v1/webhook-subscriptions/${webhookId}`,
        headers: authHeaders(otherToken, otherOrgId),
      });

      expect(getRes.statusCode).toBe(404);
    });
  });
});
