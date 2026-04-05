import type { FastifyRequest } from "fastify";

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

/**
 * A type alias for FastifyRequest that provides type safety for request components.
 *
 * @template TBody - The type of the request body. Defaults to `unknown`.
 * @template TQuery - The type of the query string parameters. Defaults to `unknown`.
 * @template TParams - The type of the route parameters. Defaults to `unknown`.
 * @template THeaders - The type of the request headers. Defaults to `unknown`.
 */
export interface ServiceResult<T = unknown> {
  data?: T;
  error?: string;
  status: number;
}

export type TypedRequest<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  THeaders = unknown,
> = FastifyRequest<{
  Body: TBody;
  Querystring: TQuery;
  Params: TParams;
  Headers: THeaders;
}>;
