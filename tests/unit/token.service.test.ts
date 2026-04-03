import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";

// Set env vars before importing TokenService
beforeAll(() => {
  process.env["JWT_SECRET"] = "test-jwt-secret";
  process.env["JWT_REFRESH_SECRET"] = "test-jwt-refresh-secret";
});

describe("TokenService", () => {
  // Dynamic import so env vars are set first
  async function getTokenService() {
    const { TokenService } = await import("../../src/lib/token.service.js");
    return TokenService;
  }

  describe("generateAccessToken", () => {
    it("should generate a valid JWT with user id and email", async () => {
      const TokenService = await getTokenService();
      const token = TokenService.generateAccessToken("user123", "test@example.com");

      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded).not.toBeNull();
      expect(decoded["id"]).toBe("user123");
      expect(decoded["email"]).toBe("test@example.com");
      expect(decoded).toHaveProperty("exp");
      expect(decoded).toHaveProperty("iat");
    });

    it("should be verifiable with the correct secret", async () => {
      const TokenService = await getTokenService();
      const token = TokenService.generateAccessToken("user123", "test@example.com");

      const payload = TokenService.verifyAccessToken(token);
      expect(payload.id).toBe("user123");
      expect(payload.email).toBe("test@example.com");
    });
  });

  describe("generateRefreshToken", () => {
    it("should generate a valid JWT with user id and unique jti", async () => {
      const TokenService = await getTokenService();
      const token = TokenService.generateRefreshToken("user123");

      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(decoded).not.toBeNull();
      expect(decoded["id"]).toBe("user123");
      expect(decoded).toHaveProperty("jti");
    });

    it("should generate unique tokens every time", async () => {
      const TokenService = await getTokenService();
      const token1 = TokenService.generateRefreshToken("user123");
      const token2 = TokenService.generateRefreshToken("user123");

      expect(token1).not.toBe(token2);
    });
  });

  describe("verifyAccessToken", () => {
    it("should throw for an invalid token", async () => {
      const TokenService = await getTokenService();
      expect(() => TokenService.verifyAccessToken("invalid")).toThrow();
    });

    it("should throw for a token signed with wrong secret", async () => {
      const TokenService = await getTokenService();
      const token = jwt.sign({ id: "user123" }, "wrong-secret");
      expect(() => TokenService.verifyAccessToken(token)).toThrow();
    });
  });

  describe("verifyRefreshToken", () => {
    it("should throw for an invalid token", async () => {
      const TokenService = await getTokenService();
      expect(() => TokenService.verifyRefreshToken("invalid")).toThrow();
    });

    it("should verify a valid refresh token", async () => {
      const TokenService = await getTokenService();
      const token = TokenService.generateRefreshToken("user456");

      const payload = TokenService.verifyRefreshToken(token);
      expect(payload.id).toBe("user456");
    });
  });
});
