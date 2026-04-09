import { z } from "zod";

export const registerSchema = {
  tags: ["Auth"],
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters"),
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name must be at most 100 characters")
      .trim(),
  }),
};

export const loginSchema = {
  tags: ["Auth"],
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required"),
  }),
};

export const refreshSchema = {
  tags: ["Auth"],
  body: z.object({
    refreshToken: z.string().min(1, "Refresh token is required"),
  }),
};

export type RegisterBody = z.infer<typeof registerSchema.body>;
export type LoginBody = z.infer<typeof loginSchema.body>;
export type RefreshBody = z.infer<typeof refreshSchema.body>;
