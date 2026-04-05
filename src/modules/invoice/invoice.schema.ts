import { z } from "zod";

const invoiceIdParams = z.object({
  id: z.string().min(1, "Invoice ID is required"),
});

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().min(0, "Unit price must be non-negative"),
});

export const createInvoiceSchema = {
  body: z.object({
    clientId: z.string().min(1, "Client ID is required"),
    lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
    taxRate: z.number().min(0).max(100).default(0).optional(),
    currency: z.string().length(3).default("USD").optional(),
    dueDate: z.string().datetime({ message: "Invalid date format" }),
    notes: z.string().max(2000).optional(),
  }),
};

export const updateInvoiceSchema = {
  params: invoiceIdParams,
  body: z.object({
    lineItems: z.array(lineItemSchema).min(1).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    dueDate: z.string().datetime().optional(),
    notes: z.string().max(2000).optional(),
  }),
};

export const getInvoiceSchema = {
  params: invoiceIdParams,
};

export const listInvoicesSchema = {
  querystring: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20).optional(),
    status: z.enum(["draft", "sent", "viewed", "paid", "partially_paid", "overdue", "cancelled"]).optional(),
    clientId: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
};

export const sendInvoiceSchema = {
  params: invoiceIdParams,
};

export const cancelInvoiceSchema = {
  params: invoiceIdParams,
};

export const markViewedSchema = {
  params: invoiceIdParams,
};

export type CreateInvoiceBody = z.infer<typeof createInvoiceSchema.body>;
export type UpdateInvoiceBody = z.infer<typeof updateInvoiceSchema.body>;
export type UpdateInvoiceParams = z.infer<typeof updateInvoiceSchema.params>;
export type GetInvoiceParams = z.infer<typeof getInvoiceSchema.params>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesSchema.querystring>;
export type SendInvoiceParams = z.infer<typeof sendInvoiceSchema.params>;
export type CancelInvoiceParams = z.infer<typeof cancelInvoiceSchema.params>;
export type MarkViewedParams = z.infer<typeof markViewedSchema.params>;
