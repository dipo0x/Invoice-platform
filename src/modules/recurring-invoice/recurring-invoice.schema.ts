import { z } from "zod";

const recurringIdParams = z.object({
  id: z.string().min(1, "Recurring invoice ID is required"),
});

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().min(0, "Unit price must be non-negative"),
});

export const createRecurringSchema = {
  body: z.object({
    clientId: z.string().min(1, "Client ID is required"),
    lineItems: z.array(lineItemSchema).min(1, "At least one line item is required"),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    taxRate: z.number().min(0).max(100).default(0).optional(),
    currency: z.string().length(3).default("USD").optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime().optional(),
    notes: z.string().max(2000).optional(),
  }),
};

export const updateRecurringSchema = {
  params: recurringIdParams,
  body: z.object({
    lineItems: z.array(lineItemSchema).min(1).optional(),
    frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    endDate: z.string().datetime().optional(),
    notes: z.string().max(2000).optional(),
  }),
};

export const getRecurringSchema = {
  params: recurringIdParams,
};

export const listRecurringSchema = {
  querystring: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20).optional(),
    status: z.enum(["active", "paused", "cancelled"]).optional(),
  }),
};

export const pauseRecurringSchema = { params: recurringIdParams };
export const resumeRecurringSchema = { params: recurringIdParams };
export const cancelRecurringSchema = { params: recurringIdParams };

export type CreateRecurringBody = z.infer<typeof createRecurringSchema.body>;
export type UpdateRecurringBody = z.infer<typeof updateRecurringSchema.body>;
export type UpdateRecurringParams = z.infer<typeof updateRecurringSchema.params>;
export type GetRecurringParams = z.infer<typeof getRecurringSchema.params>;
export type ListRecurringQuery = z.infer<typeof listRecurringSchema.querystring>;
export type ActionRecurringParams = z.infer<typeof pauseRecurringSchema.params>;
