# Invoice Platform

Permit me to write this with claude :) 


A multi-tenant SaaS API for creating invoices, collecting payments via Stripe, automating recurring billing, and delivering webhook notifications -- built with reliability patterns used by Stripe, GitHub, and Twilio.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20, TypeScript |
| Framework | Fastify |
| Database | MongoDB (Typegoose) |
| Cache | Redis (ioredis) |
| Queue | BullMQ |
| Payments | Stripe |
| Email | Resend |
| Validation | Zod |
| Auth | JWT (access + refresh tokens) |
| Testing | Vitest |
| CI/CD | GitHub Actions |

## Getting Started

### Prerequisites

- Node.js 20+
- MongoDB (local or Atlas)
- Redis

### Setup

```bash
git clone https://github.com/dipo0x/invoice-platform>
cd invoice-platform
yarn install
cp .env.example .env   # edit with your values
```

### Environment Variables

```
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/invoice-platform
REDIS_URL=redis://localhost:6379
JWT_SECRET=<change-me>
JWT_REFRESH_SECRET=<change-me>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
EMAIL_API_KEY=<resend-api-key>
```

### Run

```bash
yarn build && yarn start   # production
yarn dev                   # development (watch mode)
docker compose up          # full stack with Docker
```

### Test

```bash
yarn test                  # run all tests
yarn test:watch            # watch mode
yarn typecheck             # type checking only
```

## Architecture

```
Client (Postman / Frontend)
  |
  v
+-------------------------------------------------+
|  Fastify API Server                              |
|  +-- Auth Middleware (JWT)                        |
|  +-- Tenant Isolation Middleware                  |
|  +-- Idempotency Middleware                       |
|  +-- Rate Limiting (per-tenant)                  |
|  +-- Request Validation (Zod)                    |
|  +-- Routes -> Controllers -> Services           |
+---------+-----------+-----------+----------------+
          |           |           |
          v           v           v
       MongoDB      Redis      BullMQ Queues
       (data)     (cache,      +------------------+
                  sessions,    | notifications    |
                  idempotency) | payments         |
                               | invoices         |
                               | integrations     |
                               +--------+---------+
                                        |
                                        v
                               BullMQ Workers
                               +-- Email Sender (Resend)
                               +-- PDF Generator (PDFKit)
                               +-- Payment Processor (Stripe)
                               +-- Webhook Deliverer
                               +-- Recurring Invoice Creator

External Services:
  +-- Stripe (payments)
  +-- Resend (transactional email)
  +-- Customer webhook endpoints
```

## Modules

| Module | Endpoints | Description |
|--------|-----------|-------------|
| **Auth** | `/v1/auth/*` | Register, login, token refresh, logout |
| **Organization** | `/v1/organizations/*` | Multi-tenant org management |
| **Client** | `/v1/clients/*` | Customer/client CRUD |
| **Invoice** | `/v1/invoices/*` | Create, send, cancel invoices with line items |
| **Recurring Invoice** | `/v1/recurring-invoices/*` | Auto-generate invoices on a schedule |
| **Payment** | `/v1/invoices/:id/pay`, `/v1/payments/*` | Stripe checkout, refunds, partial refunds |
| **Webhook Subscription** | `/v1/webhook-subscriptions/*` | Subscribe to platform events |
| **Analytics** | `/v1/analytics/*` | Revenue and invoice reporting |

## Multi-Tenancy

Every request after login includes an `x-org-id` header. The tenant context middleware validates the user is a member of that org and attaches their role. All database queries are scoped to the org -- a user in Org A can never see Org B's data.

Roles: `owner`, `admin`, `accountant`, `viewer`. Role-based access control is enforced per-route.

## Queue Architecture

Four BullMQ queues handle async work with different retry strategies:

| Queue | Workers | Retries | Use Case |
|-------|---------|---------|----------|
| `notifications` | 5 concurrent | 3 attempts, 5s backoff | Sending emails |
| `invoices` | - | 3 attempts, 10s backoff | PDF generation, recurring invoice creation, overdue checks |
| `payments` | 2 concurrent | 5 attempts, 15s backoff | Refunds, payment sync, reconciliation |
| `integrations` | 10 concurrent | 8 attempts, 10s backoff | Webhook delivery to customer endpoints |

Queue dashboard available at `/admin/queues` (Bull Board).

## Reliability Engineering

### Idempotency

Payment endpoints (`/pay`, `/refund`, `/partial-refund`) support an optional `Idempotency-Key` header. When provided:

1. First request: acquires a Redis lock (SET NX), processes normally, caches the response (24h TTL)
2. Duplicate request (same key): returns the cached response without re-processing
3. Concurrent duplicate: returns 409 while the first request is still in progress

This prevents double charges when a client retries a failed network request.

**Files:** `src/lib/idempotencyStore.ts`, `src/middlewares/idempotency.middleware.ts`

### Stripe Webhook Deduplication

Stripe delivers events at least once -- the same `payment_intent.succeeded` event can arrive multiple times. Before processing, the webhook handler checks Redis for the event ID. If it's been seen before (48h window), it returns 200 immediately without re-processing.

**File:** `src/modules/payment/stripe-webhook.route.ts`

### Circuit Breaker

External service calls (Stripe, Resend, webhook delivery) are wrapped in circuit breakers that prevent cascade failures:

- **CLOSED** (normal): calls pass through. Failures are counted.
- **OPEN** (service down): calls are rejected instantly without making a network request. No 30-second timeout waits.
- **HALF_OPEN** (testing recovery): after a cooldown, one call is allowed through. If it succeeds, the circuit closes. If it fails, it reopens.

| Instance | Failure Threshold | Cooldown | Recovery Threshold |
|----------|-------------------|----------|--------------------|
| Stripe | 5 failures | 30s | 2 successes |
| Resend (email) | 3 failures | 60s | 1 success |
| Webhook delivery | 10 failures | 15s | 3 successes |

**File:** `src/lib/circuitBreaker.ts`

### Saga Pattern (Payment Checkout)

The checkout flow spans two systems (MongoDB + Stripe) that can't share a transaction. The saga orchestrates three steps with compensating actions:

```
Step 1: Create Payment record (status: "pending")
   |
   v
Step 2: Create Stripe Checkout Session
   |         |
   | fail    | success
   v         v
 Mark      Step 3: Update Payment with Stripe session ID
 payment      |         |
 as           | fail    | success
 "failed"     v         v
           Enqueue     Done -- return
           reconcile   payment URL
           job         to client
```

If Stripe fails (Step 2), the Payment record is marked as `"failed"` -- no ghost pending records. If the DB update fails after Stripe succeeds (Step 3), a reconciliation job retries linking the Stripe session to the payment via BullMQ.

**Files:** `src/lib/paymentSaga.ts`, `src/queues/workers/payment.worker.ts` (reconcile handler)

## Project Structure

```
src/
+-- main.ts                          # Entry point, graceful shutdown
+-- app.ts                           # Fastify setup, plugin/route registration
+-- config/                          # Env config, DB, Redis, Stripe
+-- modules/
|   +-- auth/                        # Registration, login, JWT tokens
|   +-- organization/                # Tenant management
|   +-- member/                      # Org membership and roles
|   +-- client/                      # Customer management
|   +-- invoice/                     # Invoice CRUD, status workflow
|   +-- recurring-invoice/           # Scheduled invoice generation
|   +-- payment/                     # Stripe checkout, refunds
|   +-- webhook-subscription/        # Outbound webhook management
|   +-- analytics/                   # Revenue reporting
+-- queues/
|   +-- registry.ts                  # Queue definitions, job types
|   +-- workers/                     # notification, invoice, payment, webhook
|   +-- jobs/                        # Job dispatchers
+-- middlewares/                     # auth, tenant, RBAC, audit, idempotency
+-- lib/                             # circuitBreaker, idempotencyStore, paymentSaga
+-- plugins/                         # health, rateLimiter, bullBoard
+-- observability/                   # Pino logger
+-- types/                           # Shared TypeScript types
tests/
+-- integration/                     # API-level tests (auth, invoice, payment, etc.)
+-- unit/                            # circuitBreaker, paymentSaga, schema validation
```

## CI/CD

GitHub Actions runs on every push and PR to `main`:

1. **Type check** -- `tsc --noEmit`
2. **Tests** -- `vitest run` with a Redis service container

## Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via a local `commit-msg` git hook. Every commit message must start with a valid type prefix:

```
<type>[optional scope]: <description>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

### Setup the hook

```bash
cp .githooks/commit-msg .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
```
