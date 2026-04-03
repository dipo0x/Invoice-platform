import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

async function registerAndLogin(
  app: FastifyInstance,
  email: string,
  name: string,
): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "password123", name },
  });

  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password: "password123" },
  });

  return res.json().accessToken;
}

describe("Organization API", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await getApp();
    token = await registerAndLogin(app, "owner@example.com", "Owner");
  });

  describe("POST /v1/organizations", () => {
    it("should create an organization and return 201", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "TechFix Lagos", slug: "techfix-lagos" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.organization.name).toBe("TechFix Lagos");
      expect(body.organization.slug).toBe("techfix-lagos");
      expect(body.organization.plan).toBe("free");
      expect(body.member.role).toBe("owner");
    });

    it("should return 409 for duplicate slug", async () => {
      await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "First Org", slug: "same-slug" },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Second Org", slug: "same-slug" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("Organization slug already taken");
    });

    it("should return 400 for invalid slug format", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Bad Slug", slug: "BAD SLUG!!" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { slug: "no-name" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/organizations/:id", () => {
    it("should return the organization for a member", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Get Org", slug: "get-org" },
      });

      const orgId = createRes.json().organization._id;

      const res = await app.inject({
        method: "GET",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Get Org");
    });

    it("should return 403 for non-member", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Private Org", slug: "private-org" },
      });

      const orgId = createRes.json().organization._id;
      const otherToken = await registerAndLogin(app, "other@example.com", "Other");

      const res = await app.inject({
        method: "GET",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${otherToken}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /v1/organizations/:id", () => {
    it("should update organization name", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Old Name", slug: "update-org" },
      });

      const orgId = createRes.json().organization._id;

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "New Name" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("New Name");
    });

    it("should return 403 for viewer trying to update", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Viewer Org", slug: "viewer-org" },
      });

      const orgId = createRes.json().organization._id;

      const viewerToken = await registerAndLogin(app, "viewer@example.com", "Viewer");

      await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "viewer@example.com", role: "viewer" },
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { name: "Hacked Name" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/organizations/:id/invite", () => {
    it("should invite a registered user", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Invite Org", slug: "invite-org" },
      });

      const orgId = createRes.json().organization._id;

      await registerAndLogin(app, "invitee@example.com", "Invitee");

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "invitee@example.com", role: "accountant" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("accountant");
    });

    it("should return 409 when inviting an existing member", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Dup Invite Org", slug: "dup-invite-org" },
      });

      const orgId = createRes.json().organization._id;

      await registerAndLogin(app, "dup-invitee@example.com", "Dup Invitee");

      await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "dup-invitee@example.com", role: "admin" },
      });

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "dup-invitee@example.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(409);
    });

    it("should return 404 for non-existent user email", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Ghost Org", slug: "ghost-org" },
      });

      const orgId = createRes.json().organization._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "ghost@example.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("should return 400 for invalid role", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Role Org", slug: "role-org" },
      });

      const orgId = createRes.json().organization._id;

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "someone@example.com", role: "superadmin" },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
