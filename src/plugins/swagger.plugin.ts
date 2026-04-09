import type { FastifyInstance } from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
} from "fastify-type-provider-zod";

export async function swaggerPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Invoice Platform API",
        description:
          "Multi-tenant SaaS API for creating invoices, collecting payments via Stripe, automating recurring billing, and delivering webhook notifications.",
        version: "1.0.0",
        contact: {
          name: "Oladipo Adesiyan",
          url: "https://github.com/dipo0x/invoice-platform",
        },
        license: {
          name: "MIT",
          url: "https://opensource.org/licenses/MIT",
        },
      },
      servers: [
        { url: "http://localhost:3000", description: "Local development" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT access token obtained from POST /v1/auth/login",
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "Auth", description: "Registration, login, and token management" },
        { name: "Organizations", description: "Multi-tenant organization management" },
        { name: "Clients", description: "Customer/client CRUD operations" },
        { name: "Invoices", description: "Invoice creation, lifecycle, and management" },
        { name: "Recurring Invoices", description: "Automated recurring invoice templates" },
        { name: "Payments", description: "Stripe checkout, refunds, and payment tracking" },
        { name: "Webhook Subscriptions", description: "Subscribe to platform events" },
        { name: "Analytics", description: "Revenue and invoice reporting" },
      ],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      persistAuthorization: true,
    },
  });
}
