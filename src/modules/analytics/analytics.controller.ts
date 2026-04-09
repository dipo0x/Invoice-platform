import type { FastifyReply } from "fastify";
import type { TypedRequest } from "../../types/index.js";
import type { RevenueReportQuery, InvoiceReportQuery } from "./analytics.schema.js";
import { AnalyticsService } from "./analytics.service.js";

export class AnalyticsController {
  static async revenue(
    request: TypedRequest<unknown, RevenueReportQuery>,
    reply: FastifyReply,
  ) {
    const result = await AnalyticsService.revenueReport(
      request.tenantContext!.orgId,
      request.query,
    );
    return reply.status(result.status).send(result.data);
  }

  static async invoices(
    request: TypedRequest<unknown, InvoiceReportQuery>,
    reply: FastifyReply,
  ) {
    const result = await AnalyticsService.invoiceReport(
      request.tenantContext!.orgId,
      request.query,
    );
    return reply.status(result.status).send(result.data);
  }
}
