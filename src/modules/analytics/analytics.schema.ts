import { z } from "zod";

export const revenueReportSchema = {
  querystring: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    currency: z.string().length(3).default("USD").optional(),
  }),
};

export const invoiceReportSchema = {
  querystring: z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
};

export type RevenueReportQuery = z.infer<typeof revenueReportSchema.querystring>;
export type InvoiceReportQuery = z.infer<typeof invoiceReportSchema.querystring>;
