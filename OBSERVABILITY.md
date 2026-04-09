# Observability Stack

OpenTelemetry tracing, Prometheus metrics, Grafana dashboards, and alerting for the invoice platform.

---

## Architecture

```
Invoice Platform API
  |
  |-- OpenTelemetry SDK (auto-instruments HTTP, MongoDB, Redis)
  |     |
  |     v
  |   Jaeger (distributed tracing UI)
  |     port 16686 -- trace viewer
  |     port 4318  -- OTLP HTTP receiver
  |
  |-- /metrics endpoint (Prometheus format)
        |
        v
      Prometheus (scrapes every 15s)
        port 9090
        |
        v
      Grafana (dashboards + alerting)
        port 3001
        login: admin / admin
```

---

## Quick Start

```bash
docker compose up
```

| Service    | URL                      |
|------------|--------------------------|
| API        | http://localhost:3000     |
| Prometheus | http://localhost:9090     |
| Grafana    | http://localhost:3001     |
| Jaeger     | http://localhost:16686    |
| Metrics    | http://localhost:3000/metrics |

Grafana dashboards and datasources are auto-provisioned -- no manual setup needed.

---

## 1. OpenTelemetry Tracing

### How it works

`src/observability/tracing.ts` initializes the OpenTelemetry Node SDK. It **must** be imported before any other module in `src/main.ts` because it works by monkey-patching libraries (HTTP, MongoDB, ioredis) at import time. If those libraries are already loaded, there is nothing to patch and you get no spans.

```typescript
// main.ts -- tracing import comes FIRST
import "./observability/tracing.js";
import { config } from "./config/index.config.js";
// ... everything else
```

### Auto-instrumentation

These are instrumented automatically (zero code changes in your routes/services):

| Library  | What you see in traces |
|----------|----------------------|
| HTTP     | Inbound/outbound HTTP request spans with method, URL, status code |
| MongoDB  | Database query spans with operation type (find, insert, update), collection name |
| ioredis  | Redis command spans (SET, GET, etc.) with key names |

### Custom business spans

Auto-instrumentation shows infrastructure operations. Custom spans show **business** operations -- these are what you search for when debugging a customer issue.

| Span Name | File | Attributes | Events |
|-----------|------|------------|--------|
| `payment.checkout` | `src/lib/paymentSaga.ts` | org_id, invoice_id, payment.id, amount, currency | saga.step1.completed, saga.step2.completed/failed, saga.step3.completed/failed |
| `stripe.webhook` | `src/modules/payment/stripe-webhook.route.ts` | stripe.event.type, stripe.event.id | stripe.event.deduplicated |
| `invoice.create` | `src/modules/invoice/invoice.service.ts` | org_id, client_id, invoice.id, invoice.number, total, currency | -- |

### Span hierarchy example

When a customer pays an invoice, the trace looks like this:

```
HTTP POST /v1/invoices/:id/pay (auto)
  └── payment.checkout (custom)
        ├── MongoDB insert Payment (auto)
        ├── HTTP POST stripe.com/checkout/sessions (auto)
        └── MongoDB update Payment (auto)
```

When a Stripe webhook arrives:

```
HTTP POST /v1/webhooks/stripe (auto)
  └── stripe.webhook (custom)
        ├── Redis SET stripe:event:evt_xxx (auto, deduplication check)
        ├── MongoDB findOneAndUpdate Payment (auto)
        └── MongoDB findOneAndUpdate Invoice (auto)
```

### Tracer instance

`src/observability/tracer.ts` exports a single tracer instance used across all business logic:

```typescript
import { tracer } from "../../observability/tracer.js";

tracer.startActiveSpan("my.operation", async (span) => {
  span.setAttributes({ "my.attribute": "value" });
  // ... do work
  span.end();
});
```

### Environment variable

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint (Jaeger, Grafana Tempo, or any OTLP-compatible collector) |

---

## 2. Prometheus Metrics

### Endpoint

`GET /metrics` returns all metrics in Prometheus exposition format. Prometheus scrapes this every 15 seconds (configured in `monitoring/prometheus/prometheus.yml`).

### Custom metrics

All defined in `src/observability/metrics.ts`.

#### HTTP metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | method, route, status_code | How long each request takes. Buckets: 5ms to 10s. Use this to calculate P50, P95, P99 latency. |
| `http_requests_total` | Counter | method, route, status_code | Total request count. Use `rate()` to get requests/second. Filter by status_code=~"5.." for error rate. |

These are recorded via a Fastify `onResponse` hook -- every request is tracked automatically. The `/metrics` endpoint itself is excluded to avoid self-referential noise.

#### Business metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `invoices_created_total` | Counter | org_id, status | Incremented in `InvoiceService.create()`. Tracks how many invoices each org creates. |
| `payments_processed_total` | Counter | org_id, status | Incremented in `PaymentService.handleWebhookEvent()`. Status is "succeeded" or "failed". Use to calculate payment success rate. |

#### Queue metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `queue_job_duration_seconds` | Histogram | queue, job_type | How long each job takes to process. Recorded in worker `completed` events using BullMQ's `processedOn`/`finishedOn` timestamps. |
| `queue_depth` | Gauge | queue | Number of waiting jobs. Goes up and down -- a steadily increasing gauge means workers can't keep up. |
| `queue_failed_total` | Counter | queue, job_type | Total failed jobs. Any increment means something broke. Payment queue failures are especially critical. |

#### External service metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `stripe_api_duration_seconds` | Histogram | operation | How long Stripe API calls take. Detects Stripe slowdowns before they cascade. |
| `circuit_breaker_state` | Gauge | service | 0 = CLOSED (normal), 1 = OPEN (rejecting calls), 2 = HALF_OPEN (testing recovery). Updated on every state transition in `src/lib/circuitBreaker.ts`. |

#### Default Node.js metrics

`prom-client` automatically collects: `nodejs_heap_size_used_bytes`, `nodejs_heap_size_total_bytes`, `nodejs_eventloop_lag_p95_seconds`, `nodejs_active_handles_total`, `process_cpu_seconds_total`, and more. These appear in the Infrastructure dashboard.

### Counter vs Gauge vs Histogram

- **Counter** -- only goes up. Use `rate()` in Prometheus to get per-second rate. Example: `payments_processed_total` -- you can't "un-process" a payment.
- **Gauge** -- goes up and down. Read the current value directly. Example: `queue_depth` -- jobs come and go.
- **Histogram** -- records distributions. Stores values in buckets so you can calculate percentiles (P50, P95, P99). Example: `http_request_duration_seconds` -- you need to know "95% of requests complete within X seconds", not just the average.

---

## 3. Grafana Dashboards

Four pre-configured dashboards are provisioned from JSON files in `monitoring/grafana/dashboards/`. Anyone who runs `docker compose up` gets the same dashboards -- no manual setup.

### Dashboard 1: API Health (`api-health.json`)

| Panel | Query | What it tells you |
|-------|-------|-------------------|
| Request Rate | `rate(http_requests_total[1m])` | How many requests per second, broken down by method/route/status. Spot traffic spikes or sudden drops. |
| Error Rate | `sum(rate(http_requests_total{status_code=~"4..\|5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100` | Percentage of requests that are errors. Should stay below 1% normally. |
| P50/P95/P99 Latency | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))` | Latency percentiles. P95 > 2s triggers an alert. If P95 spikes but P50 is fine, you have a long-tail issue (a few slow requests). |
| Top 10 Slowest Endpoints | Same query, grouped by route | Find which endpoint needs optimization first. |

### Dashboard 2: Queue Health (`queue-health.json`)

| Panel | Query | What it tells you |
|-------|-------|-------------------|
| Jobs Processed/min | `sum(rate(queue_job_duration_seconds_count[1m])) by (queue) * 60` | Throughput per queue. A sudden drop means workers may have crashed. |
| Job Failure Rate | `sum(rate(queue_failed_total[5m])) by (queue)` | Failures per second per queue. Payment queue failures = revenue loss. |
| Queue Depth | `queue_depth` | Waiting jobs. If this grows over time, you need more workers or your jobs are too slow. |
| Avg Processing Time | `rate(queue_job_duration_seconds_sum[5m]) / rate(queue_job_duration_seconds_count[5m])` | Average job duration. If PDF generation goes from 2s to 15s, this panel catches it. |

### Dashboard 3: Business Metrics (`business-metrics.json`)

| Panel | Query | What it tells you |
|-------|-------|-------------------|
| Invoices Created/day | `sum(increase(invoices_created_total[24h]))` | Daily invoice volume. Useful for business reporting. |
| Payments Succeeded/day | `sum(increase(payments_processed_total{status="succeeded"}[24h]))` | Revenue indicator. |
| Payments Failed/day | `sum(increase(payments_processed_total{status="failed"}[24h]))` | Failed payment count. |
| Payment Success Rate | `succeeded / total * 100` | Should be >95%. Below 90% triggers an alert. |
| Circuit Breaker States | `circuit_breaker_state` | Shows CLOSED/OPEN/HALF_OPEN for Stripe, Resend, webhook delivery. If any shows OPEN, an external service is down. |

### Dashboard 4: Infrastructure (`infrastructure.json`)

| Panel | Query | What it tells you |
|-------|-------|-------------------|
| Heap Used/Total | `nodejs_heap_size_used_bytes` | Memory consumption. If used approaches total, the GC is under pressure. A steady upward trend = memory leak. |
| Event Loop Lag P95 | `nodejs_eventloop_lag_p95_seconds` | If this exceeds 100ms, the event loop is blocked -- probably a CPU-intensive operation running synchronously (PDF generation, JSON parsing). |
| Active Handles/Requests | `nodejs_active_handles_total` | Open sockets, file descriptors, timers. A growing count may indicate a connection leak. |
| CPU Usage | `rate(process_cpu_seconds_total[1m])` | CPU consumption rate. Sustained >80% means you need to scale horizontally or optimize hot paths. |

---

## 4. Alerting Rules

Defined in `monitoring/grafana/provisioning/alerting/alerts.yml`. Auto-provisioned into Grafana.

| Alert | Condition | Severity | Why it matters |
|-------|-----------|----------|----------------|
| Payment DLQ has failed jobs | `queue_failed_total{queue="payments"} > 0` | Critical | A failed payment job means a customer was either not charged or not notified. Immediate investigation needed. |
| Payment failure rate > 10% | Failed/total > 10% for 5 minutes | Critical | Indicates a systemic issue -- Stripe outage, bad card processing, or a bug in the payment flow. |
| API P95 latency > 2 seconds | P95 > 2s for 5 minutes | Warning | User experience is degraded. Could be a slow query, missing index, or external service latency. |
| Queue processing stopped | Job processing rate = 0 for 5 minutes | Critical | Workers may have crashed. Queues will back up indefinitely until workers restart. |
| Circuit breaker opened | `circuit_breaker_state == 1` | Critical | An external service (Stripe, Resend, webhook endpoint) is down. All calls to that service are being rejected instantly. |

---

## File Map

```
src/observability/
  tracing.ts          -- OpenTelemetry SDK setup, auto-instrumentation, OTLP exporter
  tracer.ts           -- Shared tracer instance for custom spans
  metrics.ts          -- Prometheus metrics definitions + /metrics endpoint plugin
  logger.ts           -- Pino structured logging (existing)

monitoring/
  prometheus/
    prometheus.yml    -- Scrape config: hits api:3000/metrics every 15s
  grafana/
    provisioning/
      datasources/
        datasources.yml   -- Prometheus + Jaeger as Grafana data sources
      dashboards/
        dashboards.yml    -- Tells Grafana to load JSON files from /var/lib/grafana/dashboards
      alerting/
        alerts.yml        -- 5 alert rules auto-provisioned into Grafana
    dashboards/
      api-health.json       -- Request rate, error rate, latency percentiles
      queue-health.json     -- Job throughput, failures, queue depth
      business-metrics.json -- Invoices, payments, circuit breaker states
      infrastructure.json   -- Heap, event loop, CPU, handles
```

---

## Where Metrics Are Emitted

| File | Metrics/Spans |
|------|---------------|
| `src/observability/metrics.ts` | HTTP request duration + count (via Fastify hook) |
| `src/modules/invoice/invoice.service.ts` | `invoices_created_total` counter, `invoice.create` span |
| `src/modules/payment/payment.service.ts` | `payments_processed_total` counter |
| `src/modules/payment/stripe-webhook.route.ts` | `stripe.webhook` span |
| `src/lib/paymentSaga.ts` | `payment.checkout` span with saga step events |
| `src/lib/circuitBreaker.ts` | `circuit_breaker_state` gauge (on every state transition) |
| `src/queues/workers/payment.worker.ts` | `queue_job_duration_seconds`, `queue_failed_total` |
| `src/queues/workers/notification.worker.ts` | `queue_job_duration_seconds`, `queue_failed_total` |
| `src/queues/workers/webhook.worker.ts` | `queue_job_duration_seconds`, `queue_failed_total` |
