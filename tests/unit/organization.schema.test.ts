import { describe, it, expect } from "vitest";
import {
  createOrgSchema,
  updateOrgSchema,
  inviteMemberSchema,
} from "../../src/modules/organization/organization.schema.js";

describe("Organization Schemas", () => {
  describe("createOrgSchema", () => {
    it("should accept valid input", () => {
      const result = createOrgSchema.body.safeParse({
        name: "TechFix Lagos",
        slug: "techfix-lagos",
      });

      expect(result.success).toBe(true);
    });

    it("should reject missing name", () => {
      const result = createOrgSchema.body.safeParse({
        slug: "some-slug",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing slug", () => {
      const result = createOrgSchema.body.safeParse({
        name: "Some Org",
      });

      expect(result.success).toBe(false);
    });

    it("should reject slug with uppercase", () => {
      const result = createOrgSchema.body.safeParse({
        name: "Some Org",
        slug: "Bad-Slug",
      });

      expect(result.success).toBe(false);
    });

    it("should reject slug with spaces", () => {
      const result = createOrgSchema.body.safeParse({
        name: "Some Org",
        slug: "bad slug",
      });

      expect(result.success).toBe(false);
    });

    it("should reject slug with special characters", () => {
      const result = createOrgSchema.body.safeParse({
        name: "Some Org",
        slug: "bad!slug",
      });

      expect(result.success).toBe(false);
    });

    it("should accept slug with hyphens", () => {
      const result = createOrgSchema.body.safeParse({
        name: "My Org",
        slug: "my-cool-org-123",
      });

      expect(result.success).toBe(true);
    });

    it("should reject name over 100 characters", () => {
      const result = createOrgSchema.body.safeParse({
        name: "a".repeat(101),
        slug: "some-slug",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("updateOrgSchema", () => {
    it("should accept partial update with just name", () => {
      const result = updateOrgSchema.body.safeParse({
        name: "New Name",
      });

      expect(result.success).toBe(true);
    });

    it("should accept partial update with just settings", () => {
      const result = updateOrgSchema.body.safeParse({
        settings: { theme: "dark" },
      });

      expect(result.success).toBe(true);
    });

    it("should accept empty body", () => {
      const result = updateOrgSchema.body.safeParse({});

      expect(result.success).toBe(true);
    });
  });

  describe("inviteMemberSchema", () => {
    it("should accept valid roles", () => {
      for (const role of ["admin", "accountant", "viewer"]) {
        const result = inviteMemberSchema.body.safeParse({
          email: "test@example.com",
          role,
        });

        expect(result.success).toBe(true);
      }
    });

    it("should reject owner role in invite", () => {
      const result = inviteMemberSchema.body.safeParse({
        email: "test@example.com",
        role: "owner",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid role", () => {
      const result = inviteMemberSchema.body.safeParse({
        email: "test@example.com",
        role: "superadmin",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid email", () => {
      const result = inviteMemberSchema.body.safeParse({
        email: "not-an-email",
        role: "admin",
      });

      expect(result.success).toBe(false);
    });
  });
});
