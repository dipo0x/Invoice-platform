import { z } from "zod";

export const orgIdParamsSchema = z.object({
  id: z.string().min(1, "Organization ID is required"),
});

export const createOrgSchema = {
  tags: ["Organizations"],
  body: z.object({
    name: z
      .string()
      .min(1, "Organization name is required")
      .max(100, "Organization name must be at most 100 characters")
      .trim(),
    slug: z
      .string()
      .min(1, "Slug is required")
      .max(50, "Slug must be at most 50 characters")
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug must be lowercase alphanumeric with hyphens only",
      ),
  }),
};

export const getOrgSchema = {
  tags: ["Organizations"],
  params: orgIdParamsSchema,
};

export const updateOrgSchema = {
  tags: ["Organizations"],
  params: orgIdParamsSchema,
  body: z.object({
    name: z.string().min(1).max(100).trim().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
};

export const inviteMemberSchema = {
  tags: ["Organizations"],
  params: orgIdParamsSchema,
  body: z.object({
    email: z.string().email("Invalid email format"),
    role: z.enum(["admin", "accountant", "viewer"]),
  }),
};

export type CreateOrgBody = z.infer<typeof createOrgSchema.body>;
export type GetOrgParams = z.infer<typeof getOrgSchema.params>;
export type UpdateOrgBody = z.infer<typeof updateOrgSchema.body>;
export type UpdateOrgParams = z.infer<typeof updateOrgSchema.params>;
export type InviteMemberBody = z.infer<typeof inviteMemberSchema.body>;
export type InviteMemberParams = z.infer<typeof inviteMemberSchema.params>;
