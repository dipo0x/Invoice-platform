import { describe, it, expect } from "vitest";
import {
  createClientSchema,
  updateClientSchema,
  getClientSchema,
  listClientsSchema,
} from "../../src/modules/client/client.schema.js";

describe("Client Schemas", () => {
  // ----------------------------------------------------------------
  // createClientSchema
  // ----------------------------------------------------------------
  describe("createClientSchema.body", () => {
    it("should accept valid input with required fields only", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Acme Corp");
        expect(result.data.email).toBe("acme@example.com");
      }
    });

    it("should accept valid input with all optional fields", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
        phone: "+1-555-0100",
        address: "123 Main St, City, State",
        taxId: "TAX-12345",
        notes: "Important client with special terms",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.phone).toBe("+1-555-0100");
        expect(result.data.address).toBe("123 Main St, City, State");
        expect(result.data.taxId).toBe("TAX-12345");
        expect(result.data.notes).toBe("Important client with special terms");
      }
    });

    it("should reject missing name", () => {
      const result = createClientSchema.body.safeParse({
        email: "acme@example.com",
      });

      expect(result.success).toBe(false);
    });

    it("should reject empty name", () => {
      const result = createClientSchema.body.safeParse({
        name: "",
        email: "acme@example.com",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing email", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid email", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "not-an-email",
      });

      expect(result.success).toBe(false);
    });

    it("should reject email without domain", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "user@",
      });

      expect(result.success).toBe(false);
    });

    it("should trim the name", () => {
      const result = createClientSchema.body.safeParse({
        name: "  Acme Corp  ",
        email: "acme@example.com",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Acme Corp");
      }
    });

    it("should reject name exceeding 200 characters", () => {
      const result = createClientSchema.body.safeParse({
        name: "a".repeat(201),
        email: "acme@example.com",
      });

      expect(result.success).toBe(false);
    });

    it("should reject phone exceeding 30 characters", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
        phone: "1".repeat(31),
      });

      expect(result.success).toBe(false);
    });

    it("should reject address exceeding 500 characters", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
        address: "a".repeat(501),
      });

      expect(result.success).toBe(false);
    });

    it("should reject taxId exceeding 50 characters", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
        taxId: "T".repeat(51),
      });

      expect(result.success).toBe(false);
    });

    it("should reject notes exceeding 2000 characters", () => {
      const result = createClientSchema.body.safeParse({
        name: "Acme Corp",
        email: "acme@example.com",
        notes: "n".repeat(2001),
      });

      expect(result.success).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // updateClientSchema
  // ----------------------------------------------------------------
  describe("updateClientSchema", () => {
    it("should accept valid partial update", () => {
      const result = updateClientSchema.body.safeParse({
        name: "Updated Corp",
      });

      expect(result.success).toBe(true);
    });

    it("should accept empty body (all fields optional)", () => {
      const result = updateClientSchema.body.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject invalid email on update", () => {
      const result = updateClientSchema.body.safeParse({
        email: "bad-email",
      });

      expect(result.success).toBe(false);
    });

    it("should validate params.id is required", () => {
      const result = updateClientSchema.params.safeParse({ id: "" });
      expect(result.success).toBe(false);

      const result2 = updateClientSchema.params.safeParse({ id: "abc123" });
      expect(result2.success).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // getClientSchema
  // ----------------------------------------------------------------
  describe("getClientSchema", () => {
    it("should accept valid params", () => {
      const result = getClientSchema.params.safeParse({
        id: "665000000000000000000000",
      });

      expect(result.success).toBe(true);
    });

    it("should reject empty id", () => {
      const result = getClientSchema.params.safeParse({ id: "" });
      expect(result.success).toBe(false);
    });

    it("should accept includeDeleted=true in querystring", () => {
      const result = getClientSchema.querystring.safeParse({
        includeDeleted: "true",
      });

      expect(result.success).toBe(true);
    });

    it("should accept includeDeleted=false in querystring", () => {
      const result = getClientSchema.querystring.safeParse({
        includeDeleted: "false",
      });

      expect(result.success).toBe(true);
    });

    it("should default includeDeleted to false", () => {
      const result = getClientSchema.querystring.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeDeleted).toBe("false");
      }
    });

    it("should reject invalid includeDeleted value", () => {
      const result = getClientSchema.querystring.safeParse({
        includeDeleted: "yes",
      });

      expect(result.success).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // listClientsSchema
  // ----------------------------------------------------------------
  describe("listClientsSchema.querystring", () => {
    it("should accept empty querystring", () => {
      const result = listClientsSchema.querystring.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept search query parameter", () => {
      const result = listClientsSchema.querystring.safeParse({
        search: "Acme",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.search).toBe("Acme");
      }
    });

    it("should accept valid limit", () => {
      const result = listClientsSchema.querystring.safeParse({ limit: 50 });
      expect(result.success).toBe(true);
    });

    it("should reject limit below 1", () => {
      const result = listClientsSchema.querystring.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject limit above 100", () => {
      const result = listClientsSchema.querystring.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it("should default limit to 20", () => {
      const result = listClientsSchema.querystring.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
      }
    });

    it("should accept cursor parameter", () => {
      const result = listClientsSchema.querystring.safeParse({
        cursor: "665000000000000000000000",
      });

      expect(result.success).toBe(true);
    });

    it("should accept all query parameters together", () => {
      const result = listClientsSchema.querystring.safeParse({
        search: "test",
        limit: 10,
        cursor: "665000000000000000000000",
      });

      expect(result.success).toBe(true);
    });
  });
});
