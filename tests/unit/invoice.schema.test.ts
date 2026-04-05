import { describe, it, expect } from "vitest";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  listInvoicesSchema,
} from "../../src/modules/invoice/invoice.schema.js";

describe("Invoice Schemas", () => {
  // ----------------------------------------------------------------
  // createInvoiceSchema
  // ----------------------------------------------------------------
  describe("createInvoiceSchema.body", () => {
    const validPayload = {
      clientId: "665000000000000000000000",
      lineItems: [
        { description: "Web Development", quantity: 10, unitPrice: 150 },
      ],
      dueDate: "2026-05-01T00:00:00.000Z",
    };

    it("should accept valid input with required fields only", () => {
      const result = createInvoiceSchema.body.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should accept valid input with all optional fields", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        taxRate: 10,
        currency: "EUR",
        notes: "Payment due within 30 days",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taxRate).toBe(10);
        expect(result.data.currency).toBe("EUR");
        expect(result.data.notes).toBe("Payment due within 30 days");
      }
    });

    it("should default taxRate to 0", () => {
      const result = createInvoiceSchema.body.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.taxRate).toBe(0);
      }
    });

    it("should default currency to USD", () => {
      const result = createInvoiceSchema.body.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("USD");
      }
    });

    it("should accept multiple line items", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "Design", quantity: 5, unitPrice: 200 },
          { description: "Development", quantity: 20, unitPrice: 100 },
          { description: "QA", quantity: 8, unitPrice: 80 },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lineItems).toHaveLength(3);
      }
    });

    it("should reject empty lineItems array", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [],
      });

      expect(result.success).toBe(false);
    });

    it("should reject negative quantity in line item", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "Bad Item", quantity: -1, unitPrice: 100 },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("should reject zero quantity in line item", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "Zero Item", quantity: 0, unitPrice: 100 },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("should reject negative unitPrice in line item", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "Negative Price", quantity: 1, unitPrice: -50 },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("should accept zero unitPrice in line item", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "Free Item", quantity: 1, unitPrice: 0 },
        ],
      });

      expect(result.success).toBe(true);
    });

    it("should reject line item missing description", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { quantity: 1, unitPrice: 100 },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("should reject line item with empty description", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        lineItems: [
          { description: "", quantity: 1, unitPrice: 100 },
        ],
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid dueDate format", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        dueDate: "not-a-date",
      });

      expect(result.success).toBe(false);
    });

    it("should reject non-ISO dueDate format", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        dueDate: "05/01/2026",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing clientId", () => {
      const result = createInvoiceSchema.body.safeParse({
        lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }],
        dueDate: "2026-05-01T00:00:00.000Z",
      });

      expect(result.success).toBe(false);
    });

    it("should reject missing dueDate", () => {
      const result = createInvoiceSchema.body.safeParse({
        clientId: "665000000000000000000000",
        lineItems: [{ description: "Work", quantity: 1, unitPrice: 100 }],
      });

      expect(result.success).toBe(false);
    });

    it("should reject taxRate above 100", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        taxRate: 101,
      });

      expect(result.success).toBe(false);
    });

    it("should reject negative taxRate", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        taxRate: -5,
      });

      expect(result.success).toBe(false);
    });

    it("should reject currency not exactly 3 characters", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        currency: "US",
      });

      expect(result.success).toBe(false);

      const result2 = createInvoiceSchema.body.safeParse({
        ...validPayload,
        currency: "USDD",
      });

      expect(result2.success).toBe(false);
    });

    it("should reject notes exceeding 2000 characters", () => {
      const result = createInvoiceSchema.body.safeParse({
        ...validPayload,
        notes: "a".repeat(2001),
      });

      expect(result.success).toBe(false);
    });
  });

  // ----------------------------------------------------------------
  // updateInvoiceSchema
  // ----------------------------------------------------------------
  describe("updateInvoiceSchema", () => {
    it("should accept valid partial update", () => {
      const result = updateInvoiceSchema.body.safeParse({
        taxRate: 15,
        notes: "Updated notes",
      });

      expect(result.success).toBe(true);
    });

    it("should accept empty body (all fields optional)", () => {
      const result = updateInvoiceSchema.body.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept updated lineItems", () => {
      const result = updateInvoiceSchema.body.safeParse({
        lineItems: [
          { description: "New Work", quantity: 5, unitPrice: 300 },
        ],
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid dueDate on update", () => {
      const result = updateInvoiceSchema.body.safeParse({
        dueDate: "bad-date",
      });

      expect(result.success).toBe(false);
    });

    it("should validate params.id is required", () => {
      const result = updateInvoiceSchema.params.safeParse({ id: "" });
      expect(result.success).toBe(false);

      const result2 = updateInvoiceSchema.params.safeParse({ id: "abc123" });
      expect(result2.success).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // listInvoicesSchema
  // ----------------------------------------------------------------
  describe("listInvoicesSchema.querystring", () => {
    it("should accept empty querystring", () => {
      const result = listInvoicesSchema.querystring.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept valid status filter values", () => {
      const validStatuses = [
        "draft",
        "sent",
        "viewed",
        "paid",
        "partially_paid",
        "overdue",
        "cancelled",
      ];

      for (const status of validStatuses) {
        const result = listInvoicesSchema.querystring.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid status filter value", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        status: "invalid",
      });

      expect(result.success).toBe(false);
    });

    it("should accept valid datetime for from and to", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-12-31T23:59:59.000Z",
      });

      expect(result.success).toBe(true);
    });

    it("should reject invalid datetime format for from", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        from: "2026-01-01",
      });

      expect(result.success).toBe(false);
    });

    it("should reject invalid datetime format for to", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        to: "not-a-date",
      });

      expect(result.success).toBe(false);
    });

    it("should accept valid limit", () => {
      const result = listInvoicesSchema.querystring.safeParse({ limit: 50 });
      expect(result.success).toBe(true);
    });

    it("should reject limit below 1", () => {
      const result = listInvoicesSchema.querystring.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject limit above 100", () => {
      const result = listInvoicesSchema.querystring.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it("should accept clientId filter", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        clientId: "665000000000000000000000",
      });

      expect(result.success).toBe(true);
    });

    it("should accept cursor parameter", () => {
      const result = listInvoicesSchema.querystring.safeParse({
        cursor: "665000000000000000000000",
      });

      expect(result.success).toBe(true);
    });
  });
});
