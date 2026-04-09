import client from "prom-client";
import type { FastifyInstance } from "fastify";

// Use a default registry so all metrics are automatically registered
const register = client.register;

// Collect default Node.js metrics (CPU, memory, event loop, GC)
client.collectDefaultMetrics({ register });

// ─── HTTP Metrics ───────────────────────────────────────────────────────────

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

// ─── Business Metrics ───────────────────────────────────────────────────────

export const invoicesCreatedTotal = new client.Counter({
  name: "invoices_created_total",
  help: "Total invoices created",
  labelNames: ["org_id", "status"] as const,
});

export const paymentsProcessedTotal = new client.Counter({
  name: "payments_processed_total",
  help: "Total payments processed",
  labelNames: ["org_id", "status"] as const,
});

// ─── Queue Metrics ──────────────────────────────────────────────────────────

export const queueJobDuration = new client.Histogram({
  name: "queue_job_duration_seconds",
  help: "Duration of queue job processing in seconds",
  labelNames: ["queue", "job_type"] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
});

export const queueDepth = new client.Gauge({
  name: "queue_depth",
  help: "Number of waiting jobs per queue",
  labelNames: ["queue"] as const,
});

export const queueFailedTotal = new client.Counter({
  name: "queue_failed_total",
  help: "Total failed queue jobs",
  labelNames: ["queue", "job_type"] as const,
});

// ─── External Service Metrics ───────────────────────────────────────────────

export const stripeApiDuration = new client.Histogram({
  name: "stripe_api_duration_seconds",
  help: "Duration of Stripe API calls in seconds",
  labelNames: ["operation"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const circuitBreakerState = new client.Gauge({
  name: "circuit_breaker_state",
  help: "Circuit breaker state: 0=closed, 1=open, 2=half_open",
  labelNames: ["service"] as const,
});

// ─── Metrics Endpoint Plugin ────────────────────────────────────────────────

export async function metricsPlugin(fastify: FastifyInstance): Promise<void> {
  // Track request duration and count
  fastify.addHook("onResponse", (request, reply, done) => {
    // Skip metrics endpoint itself to avoid self-referential noise
    if (request.url === "/metrics") {
      done();
      return;
    }

    const route = request.routeOptions?.url ?? request.url;
    const method = request.method;
    const statusCode = String(reply.statusCode);
    const duration = reply.elapsedTime / 1000; // Fastify provides elapsedTime in ms

    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });

    done();
  });

  // Expose /metrics endpoint for Prometheus to scrape
  fastify.get("/metrics", async (_request, reply) => {
    const metrics = await register.metrics();
    return reply.header("Content-Type", register.contentType).send(metrics);
  });
}

export { register };
