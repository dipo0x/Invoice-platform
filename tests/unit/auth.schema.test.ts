import { describe, it, expect } from "vitest";
import { registerSchema, loginSchema, refreshSchema } from "../../src/modules/auth/auth.schema.js";

describe("Auth Schemas", () => {
  describe("registerSchema", () => {
    it("should accept valid input", () => {
      const result = registerSchema.body.safeParse({
        email: "test@example.com",
        password: "password123",
        name: "Test User",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid email", () => {
      const result = registerSchema.body.safeParse({
        email: "not-an-email",
        password: "password123",
        name: "Test User",
      });

      expect(result.success).toBe(false);
    });

    it("should reject short password", () => {
      const result = registerSchema.body.safeParse({
        email: "test@example.com",
        password: "123",
        name: "Test User",
      });

      expect(result.success).toBe(false);
    });

    it("should reject password over 128 characters", () => {
      const result = registerSchema.body.safeParse({
        email: "test@example.com",
        password: "a".repeat(129),
        name: "Test User",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing name", () => {
      const result = registerSchema.body.safeParse({
        email: "test@example.com",
        password: "password123",
      });

      expect(result.success).toBe(false);
    });

    it("should trim the name", () => {
      const result = registerSchema.body.safeParse({
        email: "test@example.com",
        password: "password123",
        name: "  Test User  ",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Test User");
      }
    });
  });

  describe("loginSchema", () => {
    it("should accept valid input", () => {
      const result = loginSchema.body.safeParse({
        email: "test@example.com",
        password: "password123",
      });

      expect(result.success).toBe(true);
    });

    it("should reject empty password", () => {
      const result = loginSchema.body.safeParse({
        email: "test@example.com",
        password: "",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("refreshSchema", () => {
    it("should accept valid input", () => {
      const result = refreshSchema.body.safeParse({
        refreshToken: "some-token-value",
      });

      expect(result.success).toBe(true);
    });

    it("should reject empty refresh token", () => {
      const result = refreshSchema.body.safeParse({
        refreshToken: "",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing refresh token", () => {
      const result = refreshSchema.body.safeParse({});

      expect(result.success).toBe(false);
    });
  });
});
