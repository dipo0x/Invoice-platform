export interface TenantContext {
  orgId: string;
  role: "owner" | "admin" | "accountant" | "viewer";
}

declare module "fastify" {
  interface FastifyRequest {
    tenantContext?: TenantContext;
    user?: {
      id: string;
      email: string;
    };
  }
}
