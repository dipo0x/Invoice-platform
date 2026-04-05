import { z } from "zod";

const invoiceIdParams = z.object({
  invoiceId: z.string().min(1, "Invoice ID is required"),
});

const paymentIdParams = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
});

export const createPaymentIntentSchema = {
  params: invoiceIdParams,
};

export const listPaymentsSchema = {
  params: invoiceIdParams,
};

export const refundPaymentSchema = {
  params: paymentIdParams,
};

export const partialRefundSchema = {
  params: paymentIdParams,
  body: z.object({
    amount: z.number().positive("Refund amount must be positive"),
  }),
};

export type CreatePaymentIntentParams = z.infer<typeof createPaymentIntentSchema.params>;
export type ListPaymentsParams = z.infer<typeof listPaymentsSchema.params>;
export type RefundPaymentParams = z.infer<typeof refundPaymentSchema.params>;
export type PartialRefundParams = z.infer<typeof partialRefundSchema.params>;
export type PartialRefundBody = z.infer<typeof partialRefundSchema.body>;
