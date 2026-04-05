import { describe, it, expect, beforeEach } from "vitest";
import { getApp } from "../helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

/** Register a user, log in, and return the access token. */
async function registerAndLogin(
  appInstance: FastifyInstance,
  email: string,
  name: string,
) {
  await appInstance.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "password123", name },
  });

  const loginRes = await appInstance.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password: "password123" },
  });

  return loginRes.json().accessToken;
}

/** Create an org and return its ID (caller is automatically owner). */
async function createOrg(
  appInstance: FastifyInstance,
  tkn: string,
  name: string,
  slug: string,
) {
  const res = await appInstance.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: { authorization: `Bearer ${tkn}` },
    payload: { name, slug },
  });
  return res.json().organization._id;
}

function authHeaders(tkn: string, org: string) {
  return { authorization: `Bearer ${tkn}`, "x-org-id": org };
}

describe("RBAC Authorization", () => {
  beforeEach(async () => {
    app = await getApp();
  });

  // ----------------------------------------------------------------
  // VIEWER ROLE
  // ----------------------------------------------------------------
  describe("Viewer role restrictions", () => {
    let ownerToken: string;
    let viewerToken: string;
    let orgId: string;

    beforeEach(async () => {
      ownerToken = await registerAndLogin(app, "rbac-owner@test.com", "RBAC Owner");
      orgId = await createOrg(app, ownerToken, "RBAC Org", "rbac-org");

      // Register the viewer user
      viewerToken = await registerAndLogin(app, "rbac-viewer@test.com", "RBAC Viewer");

      // Owner invites viewer with role "viewer"
      const inviteRes = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac-viewer@test.com", role: "viewer" },
      });

      expect(inviteRes.statusCode).toBe(201);
    });

    it("should prevent a viewer from updating the organization", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { name: "Hacked Org" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(
        "Only owners and admins can update the organization",
      );
    });

    it("should prevent a viewer from inviting another member", async () => {
      // Register a third user to try to invite
      await registerAndLogin(app, "rbac-third@test.com", "Third User");

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: { email: "rbac-third@test.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(
        "Only owners and admins can invite members",
      );
    });

    it("should allow the owner to update the organization", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: "Updated Org" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Updated Org");
    });

    it("should allow the owner to invite members", async () => {
      await registerAndLogin(app, "rbac-admin-invite@test.com", "Admin Invite");

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac-admin-invite@test.com", role: "admin" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("admin");
    });

    it("should allow a viewer to read the organization", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${viewerToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBeTruthy();
    });
  });

  // ----------------------------------------------------------------
  // ACCOUNTANT ROLE
  // ----------------------------------------------------------------
  describe("Accountant role restrictions", () => {
    let ownerToken: string;
    let accountantToken: string;
    let orgId: string;

    beforeEach(async () => {
      ownerToken = await registerAndLogin(app, "rbac2-owner@test.com", "RBAC2 Owner");
      orgId = await createOrg(app, ownerToken, "RBAC2 Org", "rbac2-org");

      // Register the accountant user
      accountantToken = await registerAndLogin(app, "rbac2-acct@test.com", "RBAC2 Accountant");

      // Owner invites accountant with role "accountant"
      const inviteRes = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac2-acct@test.com", role: "accountant" },
      });

      expect(inviteRes.statusCode).toBe(201);
    });

    it("should prevent an accountant from updating the organization", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${accountantToken}` },
        payload: { name: "Accountant Hacked Org" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(
        "Only owners and admins can update the organization",
      );
    });

    it("should prevent an accountant from inviting members", async () => {
      await registerAndLogin(app, "rbac2-extra@test.com", "Extra User");

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${accountantToken}` },
        payload: { email: "rbac2-extra@test.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe(
        "Only owners and admins can invite members",
      );
    });

    it("should allow an accountant to create invoices through tenant context", async () => {
      // First create a client as the owner (accountant needs a client to create an invoice)
      const clientRes = await app.inject({
        method: "POST",
        url: "/v1/clients",
        headers: authHeaders(ownerToken, orgId),
        payload: { name: "Acct Client", email: "acctclient@example.com" },
      });
      const cId = clientRes.json()._id;

      // Accountant creates an invoice
      const res = await app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: authHeaders(accountantToken, orgId),
        payload: {
          clientId: cId,
          lineItems: [
            { description: "Bookkeeping", quantity: 8, unitPrice: 75 },
          ],
          dueDate: "2026-08-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/);
    });

    it("should allow an accountant to read the organization", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${accountantToken}` },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ----------------------------------------------------------------
  // ADMIN ROLE
  // ----------------------------------------------------------------
  describe("Admin role privileges", () => {
    let ownerToken: string;
    let adminToken: string;
    let orgId: string;

    beforeEach(async () => {
      ownerToken = await registerAndLogin(app, "rbac3-owner@test.com", "RBAC3 Owner");
      orgId = await createOrg(app, ownerToken, "RBAC3 Org", "rbac3-org");

      adminToken = await registerAndLogin(app, "rbac3-admin@test.com", "RBAC3 Admin");

      const inviteRes = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac3-admin@test.com", role: "admin" },
      });

      expect(inviteRes.statusCode).toBe(201);
    });

    it("should allow an admin to update the organization", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: "Admin Updated Org" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe("Admin Updated Org");
    });

    it("should allow an admin to invite members", async () => {
      await registerAndLogin(app, "rbac3-invited@test.com", "Invited User");

      const res = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email: "rbac3-invited@test.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("viewer");
    });
  });

  // ----------------------------------------------------------------
  // NON-MEMBER ACCESS
  // ----------------------------------------------------------------
  describe("Non-member access denied", () => {
    it("should deny access to a user who is not a member of the org", async () => {
      const ownerToken = await registerAndLogin(app, "rbac4-owner@test.com", "RBAC4 Owner");
      const orgId = await createOrg(app, ownerToken, "RBAC4 Org", "rbac4-org");

      const outsiderToken = await registerAndLogin(app, "rbac4-outsider@test.com", "Outsider");

      const res = await app.inject({
        method: "GET",
        url: `/v1/organizations/${orgId}`,
        headers: { authorization: `Bearer ${outsiderToken}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Access denied");
    });
  });

  // ----------------------------------------------------------------
  // DUPLICATE INVITE
  // ----------------------------------------------------------------
  describe("Duplicate invite prevention", () => {
    it("should return 409 when inviting an already-existing member", async () => {
      const ownerToken = await registerAndLogin(app, "rbac5-owner@test.com", "RBAC5 Owner");
      const orgId = await createOrg(app, ownerToken, "RBAC5 Org", "rbac5-org");

      await registerAndLogin(app, "rbac5-member@test.com", "RBAC5 Member");

      // First invite succeeds
      const first = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac5-member@test.com", role: "viewer" },
      });
      expect(first.statusCode).toBe(201);

      // Second invite for the same user should fail
      const second = await app.inject({
        method: "POST",
        url: `/v1/organizations/${orgId}/invite`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { email: "rbac5-member@test.com", role: "admin" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe(
        "User is already a member of this organization",
      );
    });
  });
});
