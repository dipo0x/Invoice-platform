import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const readDuration = new Trend("read_duration", true);
const writeDuration = new Trend("write_duration", true);
const paymentDuration = new Trend("payment_duration", true);

export const options = {
  scenarios: {
    // 60% reads
    readers: {
      executor: "constant-vus",
      vus: 60,
      duration: "3m",
      exec: "readScenario",
    },
    // 30% writes
    writers: {
      executor: "constant-vus",
      vus: 30,
      duration: "3m",
      exec: "writeScenario",
    },
    // 10% payments
    payers: {
      executor: "constant-vus",
      vus: 10,
      duration: "3m",
      exec: "paymentScenario",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    errors: ["rate<0.05"],
    read_duration: ["p(95)<500"],
    write_duration: ["p(95)<1000"],
    payment_duration: ["p(95)<2000"],
  },
};

function setupAuth(prefix) {
  const uniqueId = `${prefix}-${__VU}-${Date.now()}`;
  const email = `mixed-${uniqueId}@test.com`;
  const password = "TestPass123!";

  const registerRes = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email, password, name: `Mixed ${uniqueId}` }),
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
    JSON.stringify({ name: `MixOrg ${uniqueId}`, slug: `mixorg-${uniqueId}` }),
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
    JSON.stringify({ name: `MixClient ${uniqueId}`, email: `mixclient-${uniqueId}@test.com` }),
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

// Shared state per VU
const vuState = {};

function getAuth(prefix) {
  if (!vuState.auth) {
    vuState.auth = setupAuth(prefix);
  }
  return vuState.auth;
}

function getHeaders(auth) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.accessToken}`,
    "x-org-id": auth.orgId,
  };
}

// 60% of traffic: reads
export function readScenario() {
  const auth = getAuth("read");
  if (!auth) { errorRate.add(1); sleep(1); return; }

  const headers = getHeaders(auth);

  group("read operations", () => {
    // List invoices
    const listRes = http.get(`${BASE_URL}/v1/invoices?limit=20`, { headers });
    readDuration.add(listRes.timings.duration);
    const ok1 = check(listRes, { "list invoices 200": (r) => r.status === 200 });
    errorRate.add(!ok1);

    // List clients
    const clientRes = http.get(`${BASE_URL}/v1/clients?limit=20`, { headers });
    readDuration.add(clientRes.timings.duration);
    const ok2 = check(clientRes, { "list clients 200": (r) => r.status === 200 });
    errorRate.add(!ok2);

    // Get single invoice if available
    if (listRes.status === 200) {
      const invoices = JSON.parse(listRes.body).invoices;
      if (invoices && invoices.length > 0) {
        const getRes = http.get(`${BASE_URL}/v1/invoices/${invoices[0]._id}`, { headers });
        readDuration.add(getRes.timings.duration);
        check(getRes, { "get invoice 200": (r) => r.status === 200 });
      }
    }
  });

  sleep(0.5);
}

// 30% of traffic: writes
export function writeScenario() {
  const auth = getAuth("write");
  if (!auth) { errorRate.add(1); sleep(1); return; }

  const headers = getHeaders(auth);

  group("write operations", () => {
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Create invoice
    const createRes = http.post(
      `${BASE_URL}/v1/invoices`,
      JSON.stringify({
        clientId: auth.clientId,
        lineItems: [
          { description: `Mixed write ${__ITER}`, quantity: 1, unitPrice: 150 },
        ],
        dueDate,
        taxRate: 5,
      }),
      { headers },
    );

    writeDuration.add(createRes.timings.duration);
    const ok = check(createRes, { "create invoice 201": (r) => r.status === 201 });
    errorRate.add(!ok);

    // Create client occasionally
    if (__ITER % 5 === 0) {
      const clientRes = http.post(
        `${BASE_URL}/v1/clients`,
        JSON.stringify({
          name: `Bulk Client ${__VU}-${__ITER}`,
          email: `bulk-${__VU}-${__ITER}-${Date.now()}@test.com`,
        }),
        { headers },
      );
      writeDuration.add(clientRes.timings.duration);
      check(clientRes, { "create client 201": (r) => r.status === 201 });
    }
  });

  sleep(1);
}

// 10% of traffic: payments
export function paymentScenario() {
  const auth = getAuth("pay");
  if (!auth) { errorRate.add(1); sleep(1); return; }

  const headers = getHeaders(auth);

  group("payment operations", () => {
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Create and send invoice
    const createRes = http.post(
      `${BASE_URL}/v1/invoices`,
      JSON.stringify({
        clientId: auth.clientId,
        lineItems: [
          { description: `Payment ${__ITER}`, quantity: 1, unitPrice: 200 },
        ],
        dueDate,
      }),
      { headers },
    );

    if (createRes.status !== 201) {
      errorRate.add(1);
      return;
    }

    const invoice = JSON.parse(createRes.body);
    const invoiceId = invoice._id;

    const sendRes = http.post(`${BASE_URL}/v1/invoices/${invoiceId}/send`, null, { headers });
    if (sendRes.status !== 200) {
      errorRate.add(1);
      return;
    }

    // Attempt payment
    const payRes = http.post(
      `${BASE_URL}/v1/invoices/${invoiceId}/pay`,
      null,
      {
        headers: {
          ...headers,
          "Idempotency-Key": `mixed-pay-${invoiceId}-${__VU}`,
        },
      },
    );

    paymentDuration.add(payRes.timings.duration);
    const ok = check(payRes, {
      "payment initiated": (r) => r.status === 201 || r.status === 200,
    });
    errorRate.add(!ok);
  });

  sleep(2);
}
