import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const paymentDuration = new Trend("payment_duration", true);
const idempotentHits = new Counter("idempotent_cache_hits");

export const options = {
  scenarios: {
    payment_stress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 10 },
        { duration: "1m", target: 50 },
        { duration: "1m", target: 50 },
        { duration: "20s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<3000"],
    errors: ["rate<0.10"],
    payment_duration: ["p(95)<1500"],
  },
};

function setupAuth(vuId) {
  const email = `payment-vu-${vuId}-${Date.now()}@test.com`;
  const password = "TestPass123!";

  const registerRes = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email, password, name: `Payment VU ${vuId}` }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (registerRes.status !== 201) return null;

  const loginRes = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  if (loginRes.status !== 200) return null;

  const { accessToken } = JSON.parse(loginRes.body);

  const orgRes = http.post(
    `${BASE_URL}/v1/organizations`,
    JSON.stringify({ name: `PayOrg ${vuId}`, slug: `payorg-${vuId}-${Date.now()}` }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (orgRes.status !== 201) return null;

  const org = JSON.parse(orgRes.body);
  const orgId = org.organization._id;

  const clientRes = http.post(
    `${BASE_URL}/v1/clients`,
    JSON.stringify({ name: `PayClient ${vuId}`, email: `payclient-${vuId}@test.com` }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "x-org-id": orgId,
      },
    },
  );

  if (clientRes.status !== 201) return null;

  const client = JSON.parse(clientRes.body);

  return { accessToken, orgId, clientId: client._id };
}

let authContext = null;

export default function () {
  if (!authContext) {
    authContext = setupAuth(__VU);
    if (!authContext) {
      errorRate.add(1);
      return;
    }
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authContext.accessToken}`,
    "x-org-id": authContext.orgId,
  };

  // Create an invoice to pay
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const invoiceRes = http.post(
    `${BASE_URL}/v1/invoices`,
    JSON.stringify({
      clientId: authContext.clientId,
      lineItems: [
        { description: `Payment test ${__ITER}`, quantity: 1, unitPrice: Math.floor(Math.random() * 500) + 50 },
      ],
      dueDate,
    }),
    { headers },
  );

  if (invoiceRes.status !== 201) {
    errorRate.add(1);
    return;
  }

  const invoice = JSON.parse(invoiceRes.body);
  const invoiceId = invoice._id;

  // Send the invoice (required before payment)
  const sendRes = http.post(`${BASE_URL}/v1/invoices/${invoiceId}/send`, null, { headers });
  if (sendRes.status !== 200) {
    errorRate.add(1);
    return;
  }

  group("payment checkout", () => {
    const idempotencyKey = `pay-${invoiceId}-${__VU}-${__ITER}`;

    const payRes = http.post(
      `${BASE_URL}/v1/invoices/${invoiceId}/pay`,
      null,
      {
        headers: {
          ...headers,
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    paymentDuration.add(payRes.timings.duration);
    const ok = check(payRes, {
      "payment initiated": (r) => r.status === 201 || r.status === 200,
    });
    errorRate.add(!ok);

    // Retry with same idempotency key (should return cached response)
    const retryRes = http.post(
      `${BASE_URL}/v1/invoices/${invoiceId}/pay`,
      null,
      {
        headers: {
          ...headers,
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    const idempotent = check(retryRes, {
      "idempotent retry succeeds": (r) => r.status === 201 || r.status === 200,
    });
    if (idempotent) {
      idempotentHits.add(1);
    }
  });

  group("list payments", () => {
    const res = http.get(`${BASE_URL}/v1/invoices/${invoiceId}/payments`, { headers });
    check(res, {
      "list payments 200": (r) => r.status === 200,
    });
  });

  sleep(1);
}
