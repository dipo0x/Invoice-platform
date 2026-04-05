import { z } from "zod";

const clientIdParams = z.object({
  id: z.string().min(1, "Client ID is required"),
});

export const createClientSchema = {
  body: z.object({
    name: z.string().min(1, "Name is required").max(200).trim(),
    email: z.string().email("Invalid email format"),
    phone: z.string().max(30).trim().optional(),
    address: z.string().max(500).trim().optional(),
    taxId: z.string().max(50).trim().optional(),
    notes: z.string().max(2000).optional(),
  }),
};

export const updateClientSchema = {
  params: clientIdParams,
  body: z.object({
    name: z.string().min(1).max(200).trim().optional(),
    email: z.string().email("Invalid email format").optional(),
    phone: z.string().max(30).trim().optional(),
    address: z.string().max(500).trim().optional(),
    taxId: z.string().max(50).trim().optional(),
    notes: z.string().max(2000).optional(),
  }),
};

export const getClientSchema = {
  params: clientIdParams,
  querystring: z.object({
    includeDeleted: z.enum(["true", "false"]).default("false").optional(),
  }),
};

export const listClientsSchema = {
  querystring: z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(20).optional(),
    search: z.string().optional(),
  }),
};

export const deleteClientSchema = {
  params: clientIdParams,
};

export type CreateClientBody = z.infer<typeof createClientSchema.body>;
export type UpdateClientBody = z.infer<typeof updateClientSchema.body>;
export type UpdateClientParams = z.infer<typeof updateClientSchema.params>;
export type GetClientParams = z.infer<typeof getClientSchema.params>;
export type GetClientQuery = z.infer<typeof getClientSchema.querystring>;
export type ListClientsQuery = z.infer<typeof listClientsSchema.querystring>;
export type DeleteClientParams = z.infer<typeof deleteClientSchema.params>;
