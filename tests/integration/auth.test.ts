import { describe, it, expect } from "vitest";
import { getApp } from "../helpers.js";
import { User } from "../../src/modules/auth/auth.model.js";
import argon2 from "argon2";

describe("Auth API", () => {
  describe("POST /v1/auth/register", () => {
    it("should register a new user and return 201", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "test@example.com",
          password: "password123",
          name: "Test User",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("_id");
      expect(body.email).toBe("test@example.com");
      expect(body.name).toBe("Test User");
      expect(body).not.toHaveProperty("password");
    });

    it("should return 409 for duplicate email", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "duplicate@example.com",
          password: "password123",
          name: "First User",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "duplicate@example.com",
          password: "password123",
          name: "Second User",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("Email already registered");
    });

    it("should return 400 for invalid email", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "not-an-email",
          password: "password123",
          name: "Bad Email",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for short password", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "short@example.com",
          password: "123",
          name: "Short Pass",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for missing name", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "noname@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should hash the password in the database", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "hashed@example.com",
          password: "password123",
          name: "Hashed",
        },
      });

      const user = await User.findOne({ email: "hashed@example.com" });
      expect(user).not.toBeNull();
      expect(user!.password).not.toBe("password123");
      expect(await argon2.verify(user!.password, "password123")).toBe(true);
    });
  });

  describe("POST /v1/auth/login", () => {
    it("should login and return tokens", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "login@example.com",
          password: "password123",
          name: "Login User",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "login@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");
      expect(body.user.email).toBe("login@example.com");
      expect(body.user).not.toHaveProperty("password");
    });

    it("should return 401 for wrong password", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "wrongpass@example.com",
          password: "password123",
          name: "Wrong Pass",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "wrongpass@example.com",
          password: "wrongpassword",
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("Invalid email or password");
    });

    it("should return 401 for non-existent user", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "nobody@example.com",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/auth/refresh", () => {
    it("should return new tokens with valid refresh token", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "refresh@example.com",
          password: "password123",
          name: "Refresh User",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "refresh@example.com",
          password: "password123",
        },
      });

      const loginBody = loginRes.json();

      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: loginBody.refreshToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");
      expect(body.refreshToken).not.toBe(loginBody.refreshToken);
    });

    it("should return 401 for invalid refresh token", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: "invalid-token" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return 401 when reusing a rotated refresh token", async () => {
      const app = await getApp();
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "rotated@example.com",
          password: "password123",
          name: "Rotated User",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "rotated@example.com",
          password: "password123",
        },
      });

      const oldRefreshToken = loginRes.json().refreshToken;

      // Use it once -- rotates the token
      await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: oldRefreshToken },
      });

      // Use the old one again -- should fail
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: oldRefreshToken },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("Protected routes", () => {
    it("should return 401 without authorization header", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        payload: { name: "Test Org", slug: "test-org" },
      });

      expect(res.statusCode).toBe(401);
    });

    it("should return 401 with invalid token", async () => {
      const app = await getApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/organizations",
        headers: { authorization: "Bearer invalid-token" },
        payload: { name: "Test Org", slug: "test-org" },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
