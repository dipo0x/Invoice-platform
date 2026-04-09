import mongoose from "mongoose";
import { readReplica } from "../../config/database.config.js";
import type { RevenueReportQuery, InvoiceReportQuery } from "./analytics.schema.js";

function getReadConnection(): mongoose.Connection {
  return readReplica.getConnection();
}

export class AnalyticsService {
  static async revenueReport(orgId: string, query: RevenueReportQuery) {
    const db = getReadConnection();
    const payments = db.collection("payments");

    const matchStage: Record<string, unknown> = {
      orgId: new mongoose.Types.ObjectId(orgId),
      status: "succeeded",
    };

    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter["$gte"] = new Date(query.from);
      if (query.to) dateFilter["$lte"] = new Date(query.to);
      matchStage["paidAt"] = dateFilter;
    }

    const currency = query.currency ?? "USD";

    const pipeline = [
      { $match: { ...matchStage, currency } },
      {
        $group: {
          _id: {
            year: { $year: "$paidAt" },
            month: { $month: "$paidAt" },
          },
          totalRevenue: { $sum: "$amount" },
          paymentCount: { $sum: 1 },
          avgPayment: { $avg: "$amount" },
        },
      },
      { $sort: { "_id.year": -1 as const, "_id.month": -1 as const } },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          totalRevenue: { $round: ["$totalRevenue", 2] },
          paymentCount: 1,
          avgPayment: { $round: ["$avgPayment", 2] },
        },
      },
    ];

    const monthly = await payments.aggregate(pipeline).toArray();

    const totalPipeline = [
      { $match: { ...matchStage, currency } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          paymentCount: { $sum: 1 },
          avgPayment: { $avg: "$amount" },
        },
      },
    ];

    const [totals] = await payments.aggregate(totalPipeline).toArray();

    return {
      data: {
        currency,
        totalRevenue: totals ? Math.round((totals.totalRevenue as number) * 100) / 100 : 0,
        paymentCount: (totals?.paymentCount as number) ?? 0,
        avgPayment: totals ? Math.round((totals.avgPayment as number) * 100) / 100 : 0,
        monthly,
      },
      status: 200,
    };
  }

  static async invoiceReport(orgId: string, query: InvoiceReportQuery) {
    const db = getReadConnection();
    const invoices = db.collection("invoices");

    const matchStage: Record<string, unknown> = {
      orgId: new mongoose.Types.ObjectId(orgId),
    };

    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter["$gte"] = new Date(query.from);
      if (query.to) dateFilter["$lte"] = new Date(query.to);
      matchStage["createdAt"] = dateFilter;
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$total" },
        },
      },
      {
        $project: {
          _id: 0,
          status: "$_id",
          count: 1,
          totalAmount: { $round: ["$totalAmount", 2] },
        },
      },
    ];

    const byStatus = await invoices.aggregate(pipeline).toArray();

    const overduePipeline = [
      {
        $match: {
          ...matchStage,
          status: { $in: ["sent", "viewed", "partially_paid"] },
          dueDate: { $lt: new Date() },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: "$total" },
        },
      },
    ];

    const [overdue] = await invoices.aggregate(overduePipeline).toArray();

    return {
      data: {
        byStatus,
        overdue: {
          count: (overdue?.count as number) ?? 0,
          totalAmount: overdue ? Math.round((overdue.totalAmount as number) * 100) / 100 : 0,
        },
      },
      status: 200,
    };
  }
}
