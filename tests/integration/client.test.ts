import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let token: string;
let orgId: string;

async function setupAuthAndOrg(app: FastifyInstance) {
  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: "owner@test.com", password: "password123", name: "Owner" },
  });

  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "owner@test.com", password: "password123" },
  });
  const loginBody = loginRes.json();

  const orgRes = await app.inject({
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

async function createClient(
  overrides: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/clients",
    headers: authHeaders(token, orgId),
    payload: {
      name: "Acme Corp",
      email: "acme@example.com",
      ...overrides,
    },
  });
  return res;
}

describe("Client API", () => {
  beforeEach(async () => {
    app = await getApp();
    const ctx = await setupAuthAndOrg(app);
    token = ctx.token;
    orgId = ctx.orgId;
  });

  // ----------------------------------------------------------------
  // CREATE
  // ----------------------------------------------------------------
  describe("POST /v1/clients", () => {
    it("should create a client and return 201", async () => {
      const res = await createClient();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("_id");
      expect(body.name).toBe("Acme Corp");
      expect(body.email).toBe("acme@example.com");
      expect(body.orgId).toBe(orgId);
      expect(body.deletedAt).toBeNull();
    });

    it("should create a client with all optional fields", async () => {
      const res = await createClient({
        phone: "+1-555-0100",
        address: "123 Main St",
        taxId: "TAX-12345",
        notes: "Important client",
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.phone).toBe("+1-555-0100");
      expect(body.address).toBe("123 Main St");
      expect(body.taxId).toBe("TAX-12345");
      expect(body.notes).toBe("Important client");
    });

    it("should return 400 when name is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
        payload: { email: "noname@example.com" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when email is invalid", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
        payload: { name: "Bad Email", email: "not-an-email" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when email is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
        payload: { name: "No Email" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 401 without auth header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/clients",
        payload: { name: "Unauth", email: "unauth@example.com" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  // LIST
  // ----------------------------------------------------------------
  describe("GET /v1/clients", () => {
    it("should return an empty list when no clients exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.clients).toHaveLength(0);
      expect(body.hasMore).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it("should list created clients", async () => {
      await createClient({ name: "Client A", email: "a@example.com" });
      await createClient({ name: "Client B", email: "b@example.com" });

      const res = await app.inject({
        method: "GET",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.clients).toHaveLength(2);
    });

    it("should paginate with limit and cursor", async () => {
      await createClient({ name: "Client 1", email: "c1@example.com" });
      await createClient({ name: "Client 2", email: "c2@example.com" });
      await createClient({ name: "Client 3", email: "c3@example.com" });

      const firstPage = await app.inject({
        method: "GET",
        url: "/v1/clients?limit=2",
        headers: authHeaders(token, orgId),
      });

      expect(firstPage.statusCode).toBe(200);
      const page1 = firstPage.json();
      expect(page1.clients).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).toBeTruthy();

      const secondPage = await app.inject({
        method: "GET",
        url: `/v1/clients?limit=2&cursor=${page1.nextCursor}`,
        headers: authHeaders(token, orgId),
      });

      expect(secondPage.statusCode).toBe(200);
      const page2 = secondPage.json();
      expect(page2.clients).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it("should filter clients by search query", async () => {
      await createClient({ name: "Alpha Corp", email: "alpha@example.com" });
      await createClient({ name: "Beta Inc", email: "beta@example.com" });

      const res = await app.inject({
        method: "GET",
        url: "/v1/clients?search=Alpha",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.clients).toHaveLength(1);
      expect(body.clients[0].name).toBe("Alpha Corp");
    });

    it("should search clients by email", async () => {
      await createClient({ name: "Gamma LLC", email: "gamma@special.com" });
      await createClient({ name: "Delta Ltd", email: "delta@example.com" });

      const res = await app.inject({
        method: "GET",
        url: "/v1/clients?search=special",
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.clients).toHaveLength(1);
      expect(body.clients[0].email).toBe("gamma@special.com");
    });
  });

  // ----------------------------------------------------------------
  // GET BY ID
  // ----------------------------------------------------------------
  describe("GET /v1/clients/:id", () => {
    it("should return a client by ID", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()._id).toBe(clientId);
      expect(res.json().name).toBe("Acme Corp");
    });

    it("should return 404 for non-existent client", async () => {
      const fakeId = "665000000000000000000000";
      const res = await app.inject({
        method: "GET",
        url: `/v1/clients/${fakeId}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Client not found");
    });
  });

  // ----------------------------------------------------------------
  // UPDATE
  // ----------------------------------------------------------------
  describe("PATCH /v1/clients/:id", () => {
    it("should update a client", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
        payload: { name: "Updated Corp", phone: "+1-555-9999" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Updated Corp");
      expect(res.json().phone).toBe("+1-555-9999");
      expect(res.json().email).toBe("acme@example.com");
    });

    it("should return 404 when updating non-existent client", async () => {
      const fakeId = "665000000000000000000000";
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/clients/${fakeId}`,
        headers: authHeaders(token, orgId),
        payload: { name: "Ghost" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 400 for invalid email on update", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
        payload: { email: "bad-email" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // SOFT DELETE
  // ----------------------------------------------------------------
  describe("DELETE /v1/clients/:id", () => {
    it("should soft-delete a client", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json().message).toBe("Client deleted");
    });

    it("should hide soft-deleted client from default list", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/clients",
        headers: authHeaders(token, orgId),
      });

      expect(listRes.json().clients).toHaveLength(0);
    });

    it("should hide soft-deleted client from default getById", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      expect(getRes.statusCode).toBe(404);
    });

    it("should return soft-deleted client with includeDeleted=true", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/clients/${clientId}?includeDeleted=true`,
        headers: authHeaders(token, orgId),
      });

      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()._id).toBe(clientId);
      expect(getRes.json().deletedAt).not.toBeNull();
    });

    it("should return 404 when deleting a non-existent client", async () => {
      const fakeId = "665000000000000000000000";
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/clients/${fakeId}`,
        headers: authHeaders(token, orgId),
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 404 when deleting an already-deleted client", async () => {
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      const secondDelete = await app.inject({
        method: "DELETE",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(token, orgId),
      });

      expect(secondDelete.statusCode).toBe(404);
    });
  });

  // ----------------------------------------------------------------
  // TENANT ISOLATION
  // ----------------------------------------------------------------
  describe("Tenant isolation", () => {
    it("should not allow org B to see org A clients", async () => {
      // Create a client under org A
      const createRes = await createClient();
      const clientId = createRes.json()._id;

      // Register a second user and create a different org
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

      // Try to access org A's client from org B
      const getRes = await app.inject({
        method: "GET",
        url: `/v1/clients/${clientId}`,
        headers: authHeaders(otherToken, otherOrgId),
      });

      expect(getRes.statusCode).toBe(404);
    });

    it("should not list org A clients when querying as org B", async () => {
      await createClient();

      // Set up second org
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { email: "orgb@test.com", password: "password123", name: "OrgB" },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "orgb@test.com", password: "password123" },
      });
      const otherToken = loginRes.json().accessToken;

      const orgRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${otherToken}` },
        payload: { name: "Org B", slug: "org-b" },
      });
      const otherOrgId = orgRes.json().organization._id;

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/clients",
        headers: authHeaders(otherToken, otherOrgId),
      });

      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().clients).toHaveLength(0);
    });
  });
});
